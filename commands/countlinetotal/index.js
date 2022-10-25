module.exports = {
	Name: "countlinetotal",
	Aliases: ["clt"],
	Author: "supinic",
	Cooldown: 30000,
	Description: "Fetches the amount of data lines from ALL the log tables Supibot uses, including the total size and a prediction of when the storage will run out.",
	Flags: ["mention"],
	Params: null,
	Whitelist_Response: null,
	Static_Data: null,
	Code: (async function countLineTotal (context) {
		const [response, chatLineAmount] = await Promise.all([
			sb.Got("RaspberryPi4", { url: "ssd/size" }),
			sb.Query.getRecordset(rs => rs
				.select("SUM(AUTO_INCREMENT) AS Chat_Lines")
				.from("INFORMATION_SCHEMA", "TABLES")
				.where("TABLE_SCHEMA = %s", "chat_line")
				.flat("Chat_Lines")
				.single()
			)
		]);

		const currentSize = sb.Utils.round(response.body.data.size / (10 ** 9), 3);
		const maximumSize = sb.Config.get("DATA_DRIVE_MAXIMUM_SIZE_GB", false) ?? 220; // default size is hardcoded ~220 GB
		const percentUsage = sb.Utils.round((currentSize / maximumSize) * 100, 2);

		const cooldown = {};
		if (context.channel) {
			cooldown.user = null;
			cooldown.channel = context.channel.ID;
			cooldown.length = this.Cooldown;
		}
		else {
			cooldown.user = context.user.ID;
			cooldown.channel = null;
			cooldown.length = this.Cooldown * 2;
		}

		return {
			cooldown,
			reply: sb.Utils.tag.trim `
				Currently logging ${sb.Utils.groupDigits(chatLineAmount)} lines in total across all channels,
				taking up ~${currentSize} GB of space (${percentUsage}%).
			`
		};
	}),
	Dynamic_Description: null
};
