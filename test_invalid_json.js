import fetch from "node-fetch";

async function run() {
  try {
    const res = await fetch("http://localhost:3000/api/gemini/generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json "
    });
    console.log("Status:", res.status);
    console.log("Response:", await res.text());
  } catch (e) {
    console.error(e);
  }
}
run();
