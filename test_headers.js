import fetch from "node-fetch";

async function run() {
  const bigString = "A".repeat(10);
  try {
    const res = await fetch("https://ais-dev-2bs5xazlkklqrglnet6pyh-414212700381.asia-northeast1.run.app/api/gemini/generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: bigString }] }]
      }),
      redirect: "manual"
    });
    console.log("Status:", res.status);
    console.log("Headers:", JSON.stringify([...res.headers.entries()]));
    console.log("Response:", await res.text());
  } catch (e) {
    console.error(e);
  }
}
run();
