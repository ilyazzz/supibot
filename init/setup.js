(async () => {
	const fs = require("fs").promises;
	const util = require("util");
	const { exec } = require("child_process");
	const readline = require("readline");

	const accessFile = "./db-access.js";
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Prepare readline.question for promisification
	rl.question[util.promisify.custom] = (question) => {
		return new Promise((resolve) => {
			rl.question(question, resolve);
		});
	};
	
	const ask = util.promisify(rl.question);
	const shell = util.promisify(exec);

	const accessConfig = [
		["username", "MARIA_USER", "your_username"],
		["password", "MARIA_PASSWORD", "your_password"],
		["host", "MARIA_HOST", "your_host"],
		["port", "MARIA_PORT", "your_port"],
		["socket", "MARIA_SOCKET_PATH", "your_socket"],
	];

	console.log("Checking for database access file...");
	try {
		await fs.access(accessFile);
		console.log("Database access file exists, no need to copy the example.");
	}
	catch {
		console.log("Database access file does not exist - attempting to copy example access file...");
		try {
			await fs.copyFile("./db-access.js.example", accessFile);
			console.log("Example file copied successfully.");
		}
		catch (e) {
			console.error("Copying example file failed, aborting...", e);
			process.exit(1);
		}
	}

	let accessFileString = (await fs.readFile(accessFile)).toString();
	for (const [name, config, implicit] of accessConfig) {
		if (!accessFileString.includes(config)) {
			console.log(`The variable for database ${name} is gone (${config}) - skipping...`);
		}
		else if (!accessFileString.includes(implicit)) {
			console.log(`Database ${name} is already set up - skipping...`);
		}
		else {
			const result = await ask(`Set up database ${name} - type a new value (or nothing to ${name === 'port' ? 'use 3306' : 'keep empty'})\n`);
			
			if (!result) {
				accessFileString = accessFileString.replace(implicit, "");
				await fs.writeFile(accessFile, accessFileString);
				console.log(`Variable for ${name} is now empty.`);
			}
			else {
				accessFileString = accessFileString.replace(implicit, result);
				await fs.writeFile(accessFile, accessFileString);
				console.log(`Variable for ${name} is now set up.`);		
			}
		}
	}
	console.log("Database credentials setup successfully.");

	let packageManager = process.env.DEFAULT_PACKAGEMANAGER;
	if (!packageManager) {
		do {
			packageManager = await ask("Do you use npm or yarn as your package manager?\n");
			packageManager = packageManager.toLowerCase();
		} while (packageManager !== "npm" && packageManager !== "yarn");
	}

	console.log("Setting up database structure...");
	try {
		await shell(packageManager + " run init-database");
	}
	catch (e) {
		console.error("Database structure setup failed, aborting...", e);
		process.exit(1);
	}
	console.log("Structure set up successfully.");

	console.log("Loading database credentials & query builder...");
	try {
		eval(accessFileString);
		await require("supi-core")("sb", {
			whitelist: [
				"objects/date",
				"objects/error",
				"singletons/query",
			]
		});
	}
	catch (e) {	
		console.error("Credentials/query builder load failed, aborting...", e);
		process.exit(1);
	}
	console.log("Query prepared.");

	console.log("Setting up platform access...");
	const platformList = {
		twitch: { auth: "TWITCH_OAUTH", extra: "TWITCH_CLIENT_ID", extraName: "Client ID", ID: 1 },
		discord: { auth: "DISCORD_BOT_TOKEN", ID: 2 },
		cytube: { auth: "CYTUBE_BOT_PASSWORD", ID: 3 }
	};

	const prettyList = Object.keys(platformList).join(", ") + ", or keep line empty to finish";
	let platform = null;
	let done = false;
	let automatic = false;
	do {
		const initialPlatform = process.env.INITIAL_PLATFORM;
		if (initialPlatform) {
			platform = initialPlatform;
			console.log(`Attempting automatic setup for platform ${platform}`);
			automatic = true;
		}
		else {
			platform = await ask(`Which platform would you like to set up? (${prettyList})\n`);
		}

		platform = platform.toLowerCase();
		
		if (!platform) {
			console.log("Platform setup finished.");
			done = true;
		}
		else if (!Object.keys(platformList).includes(platform)) {
			console.log("Platform not recognized, try again.");		
		}
		else {
			let pass = null;
	
			if (platform === "twitch") {
				const accessToken = process.env.TWITCH_APP_ACCESS_TOKEN;
				if (accessToken) {
					pass = accessToken;
				}
			}
			
			if (pass === null) {
				pass = await ask(`Enter authentication key for platform "${platform}":\n`);
			}

			if (!pass) {
				console.log(`Skipped setting up ${platform}!`);
				continue;
			}
				
			const configRow = await sb.Query.getRow("data", "Config");
			await configRow.load(platformList[platform].auth);	
			configRow.values.Value = pass;
			await configRow.save();		
			console.log(`Authentication key for ${platform} set up successfully.`);

			if (platformList[platform].extra) {
				let pass = null;
				const extraEnv = process.env[platformList[platform].extra];

				if (extraEnv) {
					pass = extraEnv;
				}
				else {
					pass = await ask(`Enter ${platformList[platform].extraName} for platform "${platform}":\n`);
				}
				if (!pass) {
					console.log(`Skipped setting up ${platform}!`);
					continue;
				}

				const extraRow = await sb.Query.getRow("data", "Config");
				await extraRow.load(platformList[platform].extra);
				extraRow.values.Value = pass;
				await extraRow.save();
			}

			let botName = process.env.INITIAL_BOT_NAME;
			if (!botName) {
				botName = await ask(`Enter bot's account name for platform "${platform}":\n`);

				if (!botName) {
					console.log(`Skipped setting up ${platform}!`);
					continue;
				}
			}
			
			const platformRow = await sb.Query.getRow("chat_data", "Platform");
			await platformRow.load(platformList[platform].ID);
			platformRow.values.Self_Name = botName;
			await platformRow.save();
			console.log(`Bot name for ${platform} set up successfully.`);

			let done = false;
			do {
				let channelName = null;
				const initialChannel = process.env.INITIAL_CHANNEL;

				if (initialChannel) {
					// Assume the user only wants to join one channel when setting up automatically
					channelName = initialChannel;
					done = true;
				}
				else {
					channelName = await ask(`Enter a channel name the bot should join for platform "${platform}", or leave empty to finish:\n`);
				}

				if (!channelName) {
					console.log(`Finished setting up ${platform}.`);
					done = true;
					continue;
				}
				
				const channelRow = await sb.Query.getRow("chat_data", "Channel");
				channelRow.setValues({
					Name: channelName,
					Platform: platformList[platform].ID
				});

				await channelRow.save({ 
					ignore: true
				});
				
				console.log(`Bot will now join ${platform} in channel ${channelName}.`);
				
			} while (!done);
		}	
		// Assume the user only wants to set up one platform when setting up automatically
		if (automatic) {
			done = true;
		}
	} while (!done);

	const envCommandPrefix = process.env.COMMAND_PREFIX;
	if (!envCommandPrefix) {
		const commandPrefix = await ask("Finally, select a command prefix:");

		if (commandPrefix) {
			const configRow = await sb.Query.getRow("data", "Config");
			await configRow.load("COMMAND_PREFIX");
			configRow.values.Value = commandPrefix;
			await configRow.save();
			console.log(`Command prefix set to "${commandPrefix}".`);
		}
		else {
			console.log("Command prefix setup skipped!");
		}
	}

	console.log("All done! Setup will now exit.");
	process.exit();
})();
