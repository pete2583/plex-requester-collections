import dotenv from "dotenv";
dotenv.config();

import PlexAPI from "./plex";
import OverseerrAPI from "./overseerr";
import _ from "lodash";

// --- RUTHLESS GAG ORDER ---
const originalLog = console.log;
console.log = function (...args) {
    if (typeof args[0] === 'string') {
        const msg = args[0];
        // ONLY allow our custom tags and section headers to print
        if (msg.startsWith('[') || msg.startsWith('-') || msg.startsWith('Starting') || msg.startsWith('Done') || msg.startsWith('Processing')) {
            originalLog.apply(console, args);
        }
    }
};
// --------------------------

const MS_24_HOURS = 86400000;
const isDryRun = process.env.DRY_RUN === 'true';
const startDelay = process.env.START_DELAY_MS && parseInt(process.env.START_DELAY_MS) > 0 ? parseInt(process.env.START_DELAY_MS) : 0;

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
        console.log(`[INIT] 🚨 DRY RUN MODE ENABLED: No changes will be written to Plex 🚨`);
    }

	// Fetch requests and verify Seerr connection
	const requests = await OverseerrAPI.getAllRequests("all");
    console.log(`[INIT] Total requests fetched from Seerr: ${requests ? requests.length : 0}\n`);

	const plexSections = await PlexAPI.getSections();
	const includeSections = process.env.PLEX_INCLUDE_SECTIONS ? process.env.PLEX_INCLUDE_SECTIONS.split(",") : undefined;

	_.remove(plexSections, (value) => {
		return (includeSections && includeSections.indexOf(value.key) === -1);
	});

	for (let i = 0; i < plexSections.length; i++) {
		const sectionId = parseInt(plexSections[i]?.key);

		console.log("-----------------------------------------------");
		console.log(`Starting Section: ${plexSections[i]?.title}`);
		console.log("-----------------------------------------------");

		const sectionType = plexSections[i]?.type;
		const sectionTypeCode = PlexAPI.getPlexTypeCode(sectionType);

		if (sectionType !== "movie" && sectionType !== "show") {
			continue;
		}

		const mediaItems = await PlexAPI.getAllItems(sectionId);
		let collections = await PlexAPI.getCollections(sectionId);
		await PlexAPI.getLabels(sectionId);

		for (let j = 0; j < mediaItems.length; j++) {
			const mediaId = parseInt(mediaItems[j].ratingKey);
			const mediaItem = await PlexAPI.getSingleItem(mediaId);

			if (!mediaItem) continue;

			// SAFELY MATCH SEERR TO PLEX (Force both to strings to prevent type mismatches)
			const request = _.find(requests, (item) => {
                const seerrKey = item?.media?.ratingKey;
                const plexKey = mediaItem?.ratingKey;
                return seerrKey && plexKey && String(seerrKey) === String(plexKey);
            });

			if (!request) continue;

			const plexUsername = request?.requestedBy?.plexUsername;
			if (!plexUsername) continue;

			const mediaTitle = mediaItem.title;

			if (isDryRun) {
				console.log(`[DRY RUN] MATCH FOUND:`);
				console.log(`[DRY RUN] ➔ Media: "${mediaTitle}"`);
				console.log(`[DRY RUN] ➔ Action: Would apply label [ ${plexUsername} ]`);
				console.log(`[DRY RUN] ➔ Action: Would assign to Smart Collection [ ${plexUsername} ]\n`);
				continue; 
			}

			console.log(`[LIVE] ${mediaTitle} - Requested by ${plexUsername}`);
			
			try {
				await PlexAPI.addLabelToItem(sectionId, sectionTypeCode, mediaId, plexUsername);

				if (process.env.FEATURE_CREATE_COLLECTIONS !== "0") {
					const collectionTitle = plexUsername;
					const collection = _.find(collections, (item) => item?.title === collectionTitle);

					if (!collection) {
						const mediaLabelKey = await PlexAPI.getKeyForLabel(sectionId, plexUsername);
						await PlexAPI.createSmartCollection({
							sectionId: sectionId,
							title: collectionTitle,
							titleSort: collectionTitle, 
							itemType: sectionTypeCode,
							sort: "addedAt:desc",
							query: "label=" + mediaLabelKey
						});

						collections = await PlexAPI.getCollections(sectionId);
						console.log(`[LIVE] -> Smart Collection [ ${collectionTitle} ] created`);
					}
				}
			} catch (error) {
				console.log(`[ERROR] Failed to update ${mediaTitle}: ${error.message}`);
			}
		}
		console.log(`Done Section: ${plexSections[i]?.title}\n`);
	}
	console.log("[INIT] Processing Complete.");
};
