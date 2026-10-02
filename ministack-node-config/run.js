const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	CreateFunctionCommand,
	GetFunctionCommand,
	InvokeCommand,
	LambdaClient,
} = require("@aws-sdk/client-lambda");

const runtime = process.env.CONTAINER_RUNTIME || "podman";
const image =
	process.env.MINISTACK_IMAGE ||
	"docker.artifactory.nml.com/ministackorg/ministack:latest";
const container = `ministack-node-config-${process.pid}`;
const root = __dirname;
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "ministack-config-repro-"));

function packageLambda() {
	fs.cpSync(path.join(root, "lambda", "index.js"), path.join(staging, "index.js"));
	fs.cpSync(path.join(root, "lambda", "config"), path.join(staging, "config"), {
		recursive: true,
	});
	for (const dependency of ["config", "json5"]) {
		fs.cpSync(
			path.join(root, "node_modules", dependency),
			path.join(staging, "node_modules", dependency),
			{ recursive: true }
		);
	}
	const archive = path.join(staging, "lambda.zip");
	execFileSync("zip", ["-qr", archive, "index.js", "config", "node_modules"], {
		cwd: staging,
	});
	return fs.readFileSync(archive);
}

function startMinistack() {
	const network = runtime === "podman" ? "podman" : "bridge";
	execFileSync(runtime, [
		"run",
		"-d",
		"--name",
		container,
		"-p",
		"127.0.0.1::4566",
		"-v",
		"/var/run/docker.sock:/var/run/docker.sock",
		"-e",
		`DOCKER_NETWORK=${network}`,
		image,
	]);
	const port = execFileSync(runtime, ["port", container, "4566"], {
		encoding: "utf8",
	}).trim().split(":").at(-1);
	return `http://127.0.0.1:${port}`;
}

async function waitForReady(client) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			await client.send(new GetFunctionCommand({ FunctionName: "not-created" }));
		} catch (error) {
			if (error.name === "ResourceNotFoundException") return;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error("MinStack did not become ready within 30 seconds");
}

async function invoke(client, archive, name, fixed) {
	await client.send(
		new CreateFunctionCommand({
			FunctionName: name,
			Role: "arn:aws:iam::000000000000:role/lambda-role",
			Runtime: "nodejs22.x",
			Handler: "index.handler",
			Code: { ZipFile: archive },
			Environment: { Variables: { FIX_CONFIG_DIR: fixed ? "1" : "0" } },
		})
	);
	const response = await client.send(
		new InvokeCommand({ FunctionName: name, Payload: Buffer.from("{}") })
	);
	return {
		functionError: response.FunctionError,
		body: JSON.parse(Buffer.from(response.Payload).toString("utf8")),
	};
}

async function main() {
	const archive = packageLambda();
	const endpoint = startMinistack();
	console.log(`MinStack: ${endpoint}`);
	const client = new LambdaClient({
		endpoint,
		region: "us-east-1",
		credentials: { accessKeyId: "test", secretAccessKey: "test" },
		maxAttempts: 1,
	});
	await waitForReady(client);

	const broken = await invoke(client, archive, "config-broken", false);
	console.log("Without NODE_CONFIG_DIR:", broken);
	assert.ok(broken.functionError, "Expected config.get to fail");
	assert.match(broken.body.errorMessage, /Configuration property "example.message" is not defined/);

	const fixed = await invoke(client, archive, "config-fixed", true);
	console.log("With NODE_CONFIG_DIR:", fixed);
	assert.equal(fixed.functionError, undefined);
	assert.equal(fixed.body.message, "hello from lambda config");
	assert.notEqual(fixed.body.cwd, fixed.body.codeDir);
	assert.equal(fixed.body.configDir, path.join(fixed.body.codeDir, "config"));
	console.log("Reproduced: default lookup fails; code-relative lookup succeeds.");
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => {
		try {
			execFileSync(runtime, ["rm", "-f", container], { stdio: "ignore" });
		} catch {
			// The container may not have started.
		}
		fs.rmSync(staging, { recursive: true, force: true });
	});