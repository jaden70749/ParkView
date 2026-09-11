import localtunnel from "localtunnel";

const expectedUrl = "https://odd-areas-move.loca.lt";
const retryDelayMs = 5000;
let stopping = false;
let activeTunnel = null;

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  try {
    const tunnel = await localtunnel({
      port: 5180,
      subdomain: "odd-areas-move",
      local_host: "127.0.0.1"
    });
    activeTunnel = tunnel;
    if (tunnel.url !== expectedUrl) {
      console.error(`Localtunnel assigned ${tunnel.url}; waiting for ${expectedUrl}.`);
      tunnel.close();
      activeTunnel = null;
      await wait(retryDelayMs);
      continue;
    }
    console.log(`Public CCTV API: ${tunnel.url}`);
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tunnel.once("close", finish);
      tunnel.once("error", (error) => {
        console.error(`CCTV tunnel connection error: ${error.message}`);
        tunnel.close();
        finish();
      });
    });
    activeTunnel = null;
  } catch (error) {
    console.error(`CCTV tunnel error: ${error.message}`);
  }
  if (!stopping) {
    console.log("CCTV tunnel disconnected. Reconnecting in 5 seconds...");
    await wait(retryDelayMs);
  }
}

function stop() {
  stopping = true;
  activeTunnel?.close();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
