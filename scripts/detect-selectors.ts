import { chromium } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";

const url = process.argv[2] || "https://my.clevelandclinic.org/";
console.log(`Detecting chat selectors on: ${url}\n`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(20_000);

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
await sleep(5000);

const OMNICHANNEL_FRAME = "Microsoft_Omnichannel_LCWidget_Chat_Iframe_Window";

const frames = page.frames().map(f => ({ name: f.name(), url: f.url() }));
console.log("=== FRAMES ===");
for (const f of frames) console.log(`  [${f.name || "(main)"}] ${f.url}`);
console.log();

const launcherCandidates = await page.evaluate(`(() => {
  const results = [];
  const patterns = [/chat/i, /live chat/i, /message us/i, /contact us/i, /need help/i, /let'?s chat/i, /support/i, /ask/i];
  
  // Check buttons and links
  const els = document.querySelectorAll('button, a, [role="button"], div[onclick], iframe');
  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || "").trim().slice(0, 80);
    const id = el.id || "";
    const cls = el.className || "";
    const title = el.getAttribute("title") || "";
    const aria = el.getAttribute("aria-label") || "";
    const name = el.getAttribute("name") || "";
    const src = el.getAttribute("src") || "";
    
    const combined = [text, id, cls, title, aria, name, src].join(" ");
    const matched = patterns.some(p => p.test(combined));
    
    if (matched || tag === "iframe") {
      const selector = id ? "#" + id : cls ? tag + "." + cls.split(" ").filter(Boolean).slice(0, 2).join(".") : tag;
      results.push({ tag, id, class: cls.toString().slice(0, 80), text: text.slice(0, 60), title, aria, name, src: src.slice(0, 100), selector });
    }
  }
  return results;
})()`);

console.log("=== LAUNCHER CANDIDATES (main page) ===");
for (const c of launcherCandidates as any[]) {
  console.log(`  <${c.tag}> id="${c.id}" class="${c.class}" text="${c.text}" aria="${c.aria}" title="${c.title}" src="${c.src}"`);
}
console.log();

// Check iframes for chat widgets
for (const frame of page.frames()) {
  if (frame === page.mainFrame()) continue;
  const fname = frame.name();
  try {
    const buttons = await frame.evaluate(`(() => {
      const results = [];
      const els = document.querySelectorAll('button, [role="button"], a, input, textarea, [contenteditable]');
      for (const el of els) {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || "").trim().slice(0, 80);
        const id = el.id || "";
        const cls = (el.className || "").toString().slice(0, 80);
        const type = el.getAttribute("type") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const aria = el.getAttribute("aria-label") || "";
        const role = el.getAttribute("role") || "";
        const testId = el.getAttribute("data-testid") || "";
        results.push({ tag, id, class: cls, text: text.slice(0, 60), type, placeholder, aria, role, testId });
      }
      return results;
    })()`);
    if ((buttons as any[]).length > 0) {
      console.log(`=== ELEMENTS IN FRAME: "${fname}" ===`);
      for (const b of buttons as any[]) {
        console.log(`  <${b.tag}> id="${b.id}" class="${b.class}" text="${b.text}" placeholder="${b.placeholder}" aria="${b.aria}" role="${b.role}" data-testid="${b.testId}"`);
      }
      console.log();
    }
  } catch { /* cross-origin */ }
}

// Try clicking common launchers
console.log("=== ATTEMPTING TO OPEN CHAT ===");
const omni = page.frame({ name: OMNICHANNEL_FRAME });
let opened = false;

if (omni) {
  console.log("  Found Omnichannel frame!");
  try {
    const btn = omni.getByRole("button", { name: /let'?s chat/i });
    await btn.first().waitFor({ state: "visible", timeout: 5000 });
    await btn.first().click();
    opened = true;
    console.log("  Clicked 'Let's Chat' button in Omnichannel frame.");
  } catch {
    console.log("  No 'Let's Chat' button found in Omnichannel frame.");
  }
}

if (!opened) {
  const patterns = [/chat with/i, /live chat/i, /message us/i, /contact us/i, /^chat$/i, /need help/i, /let'?s chat/i];
  for (const p of patterns) {
    try {
      const btn = page.getByRole("button", { name: p });
      await btn.first().waitFor({ state: "visible", timeout: 2000 });
      await btn.first().click();
      opened = true;
      console.log(`  Clicked launcher matching: ${p}`);
      break;
    } catch { /* next */ }
  }
}

if (!opened) console.log("  Could not auto-detect launcher.");
else {
  await sleep(4000);

  // Now look for input fields
  console.log("\n=== INPUT FIELDS AFTER OPENING CHAT ===");
  for (const frame of page.frames()) {
    const fname = frame.name() || "(main)";
    try {
      const inputs = await frame.evaluate(`(() => {
        const results = [];
        const els = document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]');
        for (const el of els) {
          const tag = el.tagName.toLowerCase();
          const id = el.id || "";
          const cls = (el.className || "").toString().slice(0, 100);
          const type = el.getAttribute("type") || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const aria = el.getAttribute("aria-label") || "";
          const testId = el.getAttribute("data-testid") || "";
          const role = el.getAttribute("role") || "";
          const visible = el.offsetParent !== null || el.offsetHeight > 0;
          results.push({ tag, id, class: cls, type, placeholder, aria, testId, role, visible });
        }
        return results;
      })()`);
      const visible = (inputs as any[]).filter((i: any) => i.visible);
      if (visible.length > 0) {
        console.log(`  Frame: "${fname}"`);
        for (const i of visible) {
          console.log(`    <${i.tag}> id="${i.id}" class="${i.class}" type="${i.type}" placeholder="${i.placeholder}" aria="${i.aria}" data-testid="${i.testId}" role="${i.role}"`);
        }
      }
    } catch { /* cross-origin */ }
  }
}

await browser.close();
console.log("\nDone.");
