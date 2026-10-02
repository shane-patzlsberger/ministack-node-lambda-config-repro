const path = require("node:path");

if (process.env.FIX_CONFIG_DIR === "1") {
	process.env.NODE_CONFIG_DIR = path.join(__dirname, "config");
}

const config = require("config");

exports.handler = async () => ({
	cwd: process.cwd(),
	codeDir: __dirname,
	configDir: process.env.NODE_CONFIG_DIR || null,
	message: config.get("example.message"),
});