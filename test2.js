import fetch from "node-fetch";

async function run() {
  const bigString = "A".repeat(10000000); // 10MB
  try {
    const res = await fetch("http://localhost:3000/api/gemini/generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: bigString }] }]
      })
    });
    console.log("Status:", res.status);
    console.log("Response:", await res.text());
  } catch (e) {
    console.error(e);
  }
}
run();
