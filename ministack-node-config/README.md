# MinStack node-config reproduction

Requires Node.js 22+, `zip`, and a running Podman machine (or Docker). The
default MinStack image is the one used by Homologous; set `MINISTACK_IMAGE` to
use another registry. The runner uses a random local port and removes only its
own container when finished.

```sh
cd repros/ministack-node-config
npm install
npm run repro
```

For Docker, run `CONTAINER_RUNTIME=docker npm run repro`.

The same zip contains `index.js`, `config/default.json`, and node-config. The
first Lambda leaves `NODE_CONFIG_DIR` unset and should fail at `config.get`.
The second sets it to `path.join(__dirname, "config")` before requiring `config`
and should return `hello from lambda config`. The runner prints both results
and exits nonzero if either expectation is not met.