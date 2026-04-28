import fetch from "node-fetch";

async function run() {
  try {
    const res = await fetch("https://ais-dev-2bs5xazlkklqrglnet6pyh-414212700381.asia-northeast1.run.app/__cookie_check.html", {
      method: "POST"
    });
    console.log("Status:", res.status);
    console.log("Response:", await res.text());
  } catch (e) {
    console.error(e);
  }
}
run();
