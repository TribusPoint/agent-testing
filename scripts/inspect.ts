import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx scripts/inspect.ts <URL>");
  console.error("Example: npx tsx scripts/inspect.ts https://example.com");
  process.exit(1);
}

const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

console.log(`Opening ${fullUrl} with DevTools...`);
console.log("Close the browser window when you're done.\n");

const browser = await chromium.launch({
  headless: false,
  args: ["--auto-open-devtools-for-tabs"],
});

const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);

await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

page.on("close", async () => {
  await browser.close();
  process.exit(0);
});
