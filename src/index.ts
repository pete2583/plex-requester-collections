import dotenv from "dotenv";
dotenv.config();

import PlexAPI from "./plex";
import OverseerrAPI from "./overseerr";
import _ from "lodash";

const MS_24_HOURS = 86400000;
// Environment toggle: Set DRY_RUN=true in the .env file
const isDryRun = process.env.DRY_RUN === 'true';

// Start after a delay, if set.
const startDelay =
	process.env.START_DELAY_MS && parseInt(process.env.START_DELAY_MS) > 0
		? parseInt(process.env.START_DELAY_MS)
		: 0;

setTimeout(() => {
	if (process.env.FEATURE_RUN_ONCE !== "1") {
		setInterval(app, MS_24_HOURS);
	}
	app();
}, startDelay);

// Main Function
const app = async function () {
    console.log(`[INIT] Starting Plex Requester Collections...`);
    if (isDryRun) {
        console.log(`[INIT] 🚨 DRY RUN MODE ENABLED: No changes will be written to Plex 🚨\n`);
    }

	// Get all the requests from Overseerr.
	const requests = await OverseerrAPI.getAllRequests("all");
	const plexSections = await PlexAPI.getSections();

	const includeSections = process.env.PLEX_INCLUDE_SECTIONS
		? process.env.PLEX_INCLUDE_SECTIONS.split(",")
		: undefined;

	_.remove(plexSections, (value) => {
		return (
			includeSections && includeSections.indexOf(value.key) === -1
		);
	});

	// Cycle through library sections.
	for (let i = 0; i < plexSections.length; i++) {
		const sectionId = parseInt(plexSections[i]?.key);

		console.log("-----------------------------------------------");
		console.log(`Starting Section: ${plexSections[i]?.title}`);
		console.log("-----------------------------------------------");

		const sectionType = plexSections[i]?.type;
		const sectionTypeCode = PlexAPI.getPlexTypeCode(sectionType);

		// We only support Movies and TV Shows for now.
		if (sectionType !== "movie" && sectionType !== "show") {
			console.log("Unsupported Media Type: " + sectionType);
			continue;
		}

		// Get all the media items and existing collections for this library section.
		const mediaItems = await PlexAPI.getAllItems(sectionId);
		let collections = await PlexAPI.getCollections(sectionId);

		// Reset cached Plex labels since we're starting a new section.
		await PlexAPI.getLabels(sectionId);

		// Cycle through each media item in the library section
		for (let j = 0; j < mediaItems.length; j++) {
			const mediaId = parseInt(mediaItems[j].ratingKey);
			const mediaItem = await PlexAPI.getSingleItem(mediaId);

			if (!mediaItem) {
				continue;
			}

			// Does a requester entry exist for this media item?
			const request = _.find(
				requests,
				(item) => item?.media?.ratingKey === mediaItem?.ratingKey
			);

			// If no request was found in Seerr, ignore it entirely (No metric bloat)
			if (!request) {
				continue;
			}

			// We found a request!
			const plexUsername = request?.requestedBy?.plexUsername;
			if (!plexUsername) continue;

			const mediaTitle = mediaItem.title;

			if (isDryRun) {
				// 🔍 DRY RUN MODE: Prints to terminal logs only
				console.log(`[DRY RUN] MATCH FOUND:`);
				console.log(`   ➔ Media: "${mediaTitle}"`);
				console.log(`   ➔ Action: Would apply label [ ${plexUsername} ]`);
				console.log(`   ➔ Action: Would assign to Smart Collection [ ${plexUsername} ]\n`);
				continue; // Skip the actual database writes
			}

			// 🚀 LIVE MODE: Actual Plex database API writes
			console.log(`[LIVE] ${mediaTitle} - Requested by ${plexUsername}`);
			
			try {
				// Tag the media item with the raw requester username
				await PlexAPI.addLabelToItem(
					sectionId,
					sectionTypeCode,
					mediaId,
					plexUsername
				);

				// Feature flag to turn off the creation of smart collections.
				if (process.env.FEATURE_CREATE_COLLECTIONS !== "0") {
					
					const collectionTitle = plexUsername;

					// Does the smart collection already exist?
					const collection = _.find(
						collections,
						(item) => item?.title === collectionTitle
					);

					// If collection does not exist, create it querying the new label.
					if (!collection) {
						const mediaLabelKey = await PlexAPI.getKeyForLabel(
							sectionId,
							plexUsername
						);

						const createCollResult = await PlexAPI.createSmartCollection({
							sectionId: sectionId,
							title: collectionTitle,
							titleSort: collectionTitle, 
							itemType: sectionTypeCode,
							sort: "addedAt:desc", // default sort
							query: "label=" + mediaLabelKey
						});

						// Update list of collections we're working with now that we've added one.
						collections = await PlexAPI.getCollections(sectionId);
						console.log(`   -> Smart Collection [ ${collectionTitle} ] created`);
					}
				}
			} catch (error) {
				console.error(`[ERROR] Failed to update ${mediaTitle}:`, error);
			}
		}
		console.log(`Done Section: ${plexSections[i]?.title}\n`);
	}
	console.log("Processing Complete.");
};
