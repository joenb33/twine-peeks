"use strict";

/**
 * Quick eval snippets for the Console tab.
 * SugarCube 2.x unless noted. Edit placeholders before running where noted.
 */
export const CONSOLE_SNIPPETS = [
  {
    group: "State",
    items: [
      { label: "Current passage", code: "SugarCube.State.passage", autoRun: true },
      { label: "Turn count", code: "SugarCube.State.turns", autoRun: true },
      { label: "Variables", code: "SugarCube.State.active.variables", autoRun: true },
      { label: "Temp variables", code: "SugarCube.State.temporary", autoRun: true },
      { label: "History length", code: "SugarCube.History.length", autoRun: true },
    ],
  },
  {
    group: "Story",
    items: [
      { label: "Story name", code: "SugarCube.Story.name", autoRun: true },
      { label: "Passage count", code: "SugarCube.Story.size", autoRun: true },
      {
        label: "All passage names",
        code: `(function(){ var a=[]; SugarCube.Story.forEach(function(p){ a.push(p.name); }); return a; })()`,
        autoRun: true,
      },
      {
        label: "Get passage text",
        code: `SugarCube.Story.get("PassageName").text`,
        autoRun: false,
      },
      { label: "Has visited?", code: `hasVisited("PassageName")`, autoRun: false },
      { label: "Visit count", code: `visited("PassageName")`, autoRun: false },
    ],
  },
  {
    group: "Engine",
    items: [
      { label: "SugarCube version", code: "SugarCube.version", autoRun: true },
      { label: "Setup keys", code: "Object.keys(SugarCube.setup)", autoRun: true },
      {
        label: "Go to passage",
        code: `SugarCube.Engine.play("PassageName")`,
        autoRun: false,
      },
      {
        label: "Restart story",
        code: "SugarCube.Engine.restart()",
        autoRun: false,
        confirm: "Restart the story? Unsaved progress will be lost.",
      },
    ],
  },
  {
    group: "Saves",
    items: [
      { label: "Browser saves count", code: "Save.browser.size", autoRun: true },
      { label: "Auto save entries", code: "Save.browser.auto.entries()", autoRun: true },
      { label: "Slot save entries", code: "Save.browser.slot.entries()", autoRun: true },
    ],
  },
  {
    group: "Other formats",
    items: [
      { label: "Chapbook: trail", code: `window.engine && engine.state.get("trail")`, autoRun: true },
      { label: "Harlowe: story name", code: `document.querySelector("tw-story")?.getAttribute("name")`, autoRun: true },
    ],
  },
];

/**
 * @param {HTMLElement} container
 * @param {HTMLTextAreaElement} inputEl
 * @param {(code: string) => void | Promise<void>} runEval
 */
export function mountSnippetBar(container, inputEl, runEval) {
  container.innerHTML = "";

  for (const group of CONSOLE_SNIPPETS) {
    const section = document.createElement("div");
    section.className = "snippet-group";

    const title = document.createElement("div");
    title.className = "snippet-group-title";
    title.textContent = group.group;
    section.appendChild(title);

    const row = document.createElement("div");
    row.className = "snippet-row";

    for (const item of group.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "snippet-btn";
      btn.textContent = item.label;
      btn.title = item.code;
      btn.addEventListener("click", async () => {
        inputEl.value = item.code;
        inputEl.focus();
        if (item.confirm && !confirm(item.confirm)) return;
        if (item.autoRun !== false) {
          await runEval(item.code);
        }
      });
      row.appendChild(btn);
    }

    section.appendChild(row);
    container.appendChild(section);
  }
}
