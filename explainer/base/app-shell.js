/* App-shell.js — shared interactivity for recipe: "app-sketch".
   Injected by assemble.py after the content and before page-js.

   Provides: theme toggle, tab switching, info-panel toggle, reset hook.
   The author's page-js must define window.onSketchReset to reset the state
   machine, and may define window.onTabSwitch (optional) to react to tab
   changes (e.g., re-render portals).

   Conventions (must match the content slot's HTML):
   - Theme toggle:  <button id="themeToggle">
   - Tabs:          <button class="tab" data-portal="key">
   - Portals:       <div class="portal" data-portal="key">
   - Reset:         <button id="resetBtn">
   - Info toggle:   <button id="infoToggle" aria-expanded="false"> + <section id="infoPanel" aria-hidden="true">
*/
(function () {
  "use strict";

  // Theme toggle
  const themeToggle = document.querySelector("#themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      var h = document.documentElement;
      h.dataset.theme = h.dataset.theme !== "light" ? "light" : "dark";
    });
  }

  // Tab switching — generic, accessible, and works with any number of portals.
  function updateTabs(key) {
    tabs.forEach((t) => {
      var active = t.dataset.portal === key;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
      t.setAttribute("tabindex", active ? "0" : "-1");
    });
    portals.forEach((p) => {
      var visible = p.dataset.portal === key;
      p.classList.toggle("hidden", !visible);
      p.setAttribute("aria-hidden", visible ? "false" : "true");
    });
  }
  const tabs = document.querySelectorAll(".tab[data-portal]");
  const portals = document.querySelectorAll(".portal[data-portal]");
  if (tabs.length > 0 && portals.length > 0) {
    const portalByKey = {};
    portals.forEach((portal, index) => {
      var key = portal.dataset.portal;
      portalByKey[key] = portal;
      portal.setAttribute("role", "tabpanel");
      if (!portal.id) {
        portal.id = "sketch-panel-" + index;
      }
    });
    const tabList = tabs[0].closest(".tabs");
    if (tabList) {
      tabList.setAttribute("role", "tablist");
      if (!tabList.getAttribute("aria-label")) {
        tabList.setAttribute("aria-label", "Sketch views");
      }
    }
    tabs.forEach((tab, index) => {
      var key = tab.dataset.portal;
      var portal = portalByKey[key];
      tab.setAttribute("role", "tab");
      if (!tab.id) {
        tab.id = "sketch-tab-" + index;
      }
      if (portal) {
        tab.setAttribute("aria-controls", portal.id);
        portal.setAttribute("aria-labelledby", tab.id);
      }
    });
    const initialKey = tabs[0].dataset.portal;
    updateTabs(initialKey);
    function activateTab(tab) {
      const key = tab.dataset.portal;
      updateTabs(key);
      if (typeof window.onTabSwitch === "function") {
        window.onTabSwitch(key);
      }
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", function () {
        activateTab(tab);
      });
      tab.addEventListener("keydown", function (event) {
        var nextIndex;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          nextIndex = (index + 1) % tabs.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = tabs.length - 1;
        } else {
          return;
        }
        event.preventDefault();
        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex]);
      });
    });
  }

  // Info panel toggle
  function updateInfoPanel() {
    const open = infoPanel.classList.contains("open");
    infoToggle.setAttribute("aria-expanded", open ? "true" : "false");
    infoToggle.classList.toggle("active", open);
    infoPanel.setAttribute("aria-hidden", open ? "false" : "true");
  }
  const infoToggle = document.querySelector("#infoToggle");
  const infoPanel = document.querySelector("#infoPanel");
  if (infoToggle && infoPanel) {
    updateInfoPanel();
    infoToggle.addEventListener("click", () => {
      infoPanel.classList.toggle("open");
      updateInfoPanel();
    });
  }

  // Reset — delegates to the author's page-js via window.onSketchReset
  const resetBtn = document.querySelector("#resetBtn");
  if (resetBtn) {
    if (typeof window.onSketchReset !== "function") {
      console.error("app-sketch requires window.onSketchReset to be defined in page-js");
    }
    resetBtn.addEventListener("click", () => {
      if (typeof window.onSketchReset === "function") {
        window.onSketchReset();
      }
    });
  }
})();
