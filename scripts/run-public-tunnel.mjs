import localtunnel from "localtunnel";

const expectedUrl = "https://odd-areas-move.loca.lt";
const retryDelayMs = 5000;
let stopping = false;
let activeTunnel = null;
let startupDeadline = null;

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  try {
    // The library can retry its initial handshake forever without rejecting.
    startupDeadline = setTimeout(() => {
      console.error("CCTV tunnel HTTPS handshake timed out. Restarting the tunnel client.");
      process.exit(1);
    }, 30000);
    const tunnel = await localtunnel({
      port: 5180,
      subdomain: "odd-areas-move",
      local_host: "127.0.0.1"
    });
    activeTunnel = tunnel;
    const connectionEnded = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tunnel.once("close", finish);
      // Localtunnel can emit more than one socket error while a failed
      // cluster is closing, so this listener must remain attached.
      tunnel.on("error", (error) => {
        if (settled) return;
        console.error(`CCTV tunnel connection error: ${error.message}`);
        tunnel.close();
        finish();
      });
    });
    if (tunnel.url !== expectedUrl) {
      clearTimeout(startupDeadline);
      console.error(`Localtunnel assigned ${tunnel.url}; waiting for ${expectedUrl}.`);
      tunnel.close();
      activeTunnel = null;
      await wait(retryDelayMs);
      continue;
    }
    const response = await fetch(`${expectedUrl}/api/health`, {
      method: "OPTIONS",
      headers: { Origin: "https://jaden70749.github.io", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,bypass-tunnel-reminder" },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status !== 204 || response.headers.get("access-control-allow-origin") !== "https://jaden70749.github.io") {
      throw new Error("Public API CORS health check failed");
    }
    clearTimeout(startupDeadline);
    console.log(`Public CCTV API: ${tunnel.url}`);
    await connectionEnded;
    activeTunnel = null;
  } catch (error) {
    clearTimeout(startupDeadline);
    activeTunnel?.close();
    activeTunnel = null;
    console.error(`CCTV tunnel error: ${error.message}`);
  }
  if (!stopping) {
    console.log("CCTV tunnel disconnected. Reconnecting in 5 seconds...");
    await wait(retryDelayMs);
  }
}

function stop() {
  stopping = true;
  clearTimeout(startupDeadline);
  activeTunnel?.close();
  process.exit(0);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
