import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "a[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "[role='button']:not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
  "[data-dpad-focusable]",
].join(",");

const DIRECTION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const BACK_KEYS = new Set(["Backspace", "BrowserBack", "GoBack"]);

function isUsable(element) {
  return element instanceof HTMLElement
    && element.isConnected
    && !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && element.getClientRects().length > 0;
}

function getFocusableElements(root = document) {
  const elements = [];
  for (const element of root.querySelectorAll(FOCUSABLE_SELECTOR)) {
    if (isUsable(element)) elements.push(element);
  }
  return elements;
}

function isEditable(element) {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || element?.isContentEditable;
}

function shouldKeepArrowInControl(element, key) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element?.isContentEditable) {
    return true;
  }

  if (!(element instanceof HTMLInputElement)) return false;
  const nativeArrowTypes = new Set(["range", "number", "date", "time", "datetime-local", "month", "week"]);
  return nativeArrowTypes.has(element.type) || key === "ArrowLeft" || key === "ArrowRight";
}

function centerOf(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function directionalScore(originRect, candidateRect, key) {
  const origin = centerOf(originRect);
  const candidate = centerOf(candidateRect);
  const dx = candidate.x - origin.x;
  const dy = candidate.y - origin.y;

  if (key === "ArrowRight" && dx <= 1) return Infinity;
  if (key === "ArrowLeft" && dx >= -1) return Infinity;
  if (key === "ArrowDown" && dy <= 1) return Infinity;
  if (key === "ArrowUp" && dy >= -1) return Infinity;

  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const primaryDistance = Math.abs(horizontal ? dx : dy);
  const secondaryDistance = Math.abs(horizontal ? dy : dx);
  const overlapsAxis = horizontal
    ? candidateRect.bottom >= originRect.top && candidateRect.top <= originRect.bottom
    : candidateRect.right >= originRect.left && candidateRect.left <= originRect.right;

  return primaryDistance + secondaryDistance * (overlapsAxis ? 0.25 : 2.5);
}

function getEffectiveZIndex(element) {
  let highest = 0;
  let current = element;

  while (current && current !== document.body) {
    const zIndex = Number.parseInt(window.getComputedStyle(current).zIndex, 10);
    if (Number.isFinite(zIndex)) highest = Math.max(highest, zIndex);
    current = current.parentElement;
  }

  return highest;
}

function getNavigationRoot(activeElement) {
  const ownScope = activeElement instanceof HTMLElement
    ? activeElement.closest("[data-dpad-scope], [aria-modal='true']")
    : null;
  const scopes = [...document.querySelectorAll("[data-dpad-scope], [aria-modal='true']")];

  for (const element of document.querySelectorAll("[style*='position: fixed']")) {
    const rect = element.getBoundingClientRect();
    if (rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8) scopes.push(element);
  }

  let topScope = isUsable(ownScope) ? ownScope : null;
  let topZIndex = topScope ? getEffectiveZIndex(topScope) : -1;

  for (const scope of scopes) {
    if (!isUsable(scope)) continue;
    const zIndex = getEffectiveZIndex(scope);
    if (!topScope || zIndex >= topZIndex) {
      topScope = scope;
      topZIndex = zIndex;
    }
  }

  return topScope || document;
}

function getDirectContainerItem(container, element) {
  let item = element;
  while (item && item.parentElement !== container) item = item.parentElement;
  return item?.parentElement === container ? item : null;
}

function getItemFocusable(item) {
  if (item.matches?.(FOCUSABLE_SELECTOR) && isUsable(item)) return item;
  for (const element of item.querySelectorAll(FOCUSABLE_SELECTOR)) {
    if (isUsable(element)) return element;
  }
  return null;
}

function getSiblingFocusable(item, step) {
  let sibling = step < 0 ? item.previousElementSibling : item.nextElementSibling;
  while (sibling) {
    const element = getItemFocusable(sibling);
    if (element) return { item: sibling, element };
    sibling = step < 0 ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return null;
}

function findNearestCategoryButton(activeElement) {
  const sidebar = document.querySelector(".iptv-category-sidebar");
  if (!sidebar || !isUsable(sidebar)) return null;

  const originRect = activeElement.getBoundingClientRect();
  let bestElement = null;
  let bestScore = Infinity;

  for (const element of sidebar.querySelectorAll(".iptv-category-button")) {
    if (!isUsable(element)) continue;
    const rect = element.getBoundingClientRect();
    const score = Math.abs(centerOf(rect).y - centerOf(originRect).y) + Math.abs(rect.right - originRect.left) * 0.1;
    if (score < bestScore) {
      bestElement = element;
      bestScore = score;
    }
  }

  return bestElement;
}

function findNearestGridButton(activeElement) {
  const grid = document.querySelector(".iptv-media-grid");
  if (!grid || !isUsable(grid)) return null;
  const originRect = activeElement.getBoundingClientRect();
  let bestElement = null;
  let bestScore = Infinity;

  for (const element of grid.querySelectorAll(".iptv-card-primary-action")) {
    if (!isUsable(element)) continue;
    const score = directionalScore(originRect, element.getBoundingClientRect(), "ArrowRight");
    if (score < bestScore) {
      bestElement = element;
      bestScore = score;
    }
  }

  return bestElement;
}

function findNearestContentButton(activeElement, key = "ArrowDown") {
  const selectors = [
    ".iptv-media-grid .iptv-card-primary-action",
    "[data-dpad-row] .iptv-card-primary-action",
    ".iptv-category-button",
  ].join(",");
  const originRect = activeElement.getBoundingClientRect();
  let bestElement = null;
  let bestScore = Infinity;

  for (const element of document.querySelectorAll(selectors)) {
    if (!isUsable(element)) continue;
    const score = directionalScore(originRect, element.getBoundingClientRect(), key);
    if (score < bestScore) {
      bestElement = element;
      bestScore = score;
    }
  }

  return bestElement;
}

function findTopNavNeighbor(activeElement, key, lastGridFocusElement) {
  const container = activeElement.closest(".iptv-nav");
  if (!container) return null;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    const activeItem = getDirectContainerItem(container, activeElement) || activeElement.closest("[data-iptv-nav], button");
    const step = key === "ArrowLeft" ? -1 : 1;
    return {
      container,
      element: activeItem ? getSiblingFocusable(activeItem, step)?.element || null : null,
      preventFallback: true,
    };
  }

  if (key === "ArrowDown") {
    return {
      container,
      element: isUsable(lastGridFocusElement) ? lastGridFocusElement : findNearestContentButton(activeElement, key),
      preventFallback: true,
    };
  }

  if (key === "ArrowUp") {
    return { container, element: null, preventFallback: true };
  }

  return null;
}

function findCategorySidebarNeighbor(activeElement, key, lastGridFocusElement) {
  const container = activeElement.closest(".iptv-category-sidebar");
  if (!container) return null;

  if (key === "ArrowUp" || key === "ArrowDown") {
    const activeItem = activeElement.closest(".iptv-category-button");
    const step = key === "ArrowUp" ? -1 : 1;
    return {
      container,
      element: activeItem ? getSiblingFocusable(activeItem, step)?.element || null : null,
      preventFallback: true,
    };
  }

  if (key === "ArrowRight") {
    return {
      container,
      element: isUsable(lastGridFocusElement) ? lastGridFocusElement : findNearestGridButton(activeElement),
      preventFallback: true,
    };
  }

  if (key === "ArrowLeft") {
    return { container, element: null, preventFallback: true };
  }

  return null;
}

function findGridNeighbor(activeElement, key) {
  const container = activeElement.closest(".iptv-media-grid, [data-dpad-row]");
  if (!container) return null;

  const activeItem = getDirectContainerItem(container, activeElement);
  if (!activeItem) return { container, element: null };

  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const isRow = container.hasAttribute("data-dpad-row");
  const step = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const originRect = activeElement.getBoundingClientRect();
  const originCenter = centerOf(originRect);

  if (horizontal) {
    const candidate = getSiblingFocusable(activeItem, step);
    if (!candidate) {
      return {
        container,
        element: key === "ArrowLeft" && !isRow ? findNearestCategoryButton(activeElement) : null,
      };
    }
    if (isRow) return { container, element: candidate.element };

    const candidateRect = candidate.element.getBoundingClientRect();
    const rowTolerance = Math.max(12, originRect.height * 0.45);
    const sameRow = Math.abs(centerOf(candidateRect).y - originCenter.y) <= rowTolerance;
    return {
      container,
      element: sameRow ? candidate.element : (key === "ArrowLeft" ? findNearestCategoryButton(activeElement) : null),
    };
  }

  if (isRow) return { container, element: null };

  let bestElement = null;
  let bestRowDistance = Infinity;
  let bestColumnDistance = Infinity;
  const rowTolerance = Math.max(12, originRect.height * 0.45);
  let candidate = getSiblingFocusable(activeItem, step);

  while (candidate) {
    const candidateRect = candidate.element.getBoundingClientRect();
    const candidateCenter = centerOf(candidateRect);
    const rowDistance = Math.abs(candidateCenter.y - originCenter.y);

    if (rowDistance <= rowTolerance) {
      candidate = getSiblingFocusable(candidate.item, step);
      continue;
    }
    if (bestElement && rowDistance > bestRowDistance + rowTolerance) break;

    const columnDistance = Math.abs(candidateCenter.x - originCenter.x);
    if (rowDistance < bestRowDistance - rowTolerance) {
      bestElement = candidate.element;
      bestRowDistance = rowDistance;
      bestColumnDistance = columnDistance;
    } else if (columnDistance < bestColumnDistance) {
      bestElement = candidate.element;
      bestColumnDistance = columnDistance;
    }
    candidate = getSiblingFocusable(candidate.item, step);
  }

  return { container, element: bestElement };
}

function findDirectionalNeighbor(activeElement, key, root, excludedContainer = null) {
  const originRect = activeElement.getBoundingClientRect();
  let bestElement = null;
  let bestScore = Infinity;

  for (const element of root.querySelectorAll(FOCUSABLE_SELECTOR)) {
    if (element === activeElement || excludedContainer?.contains(element) || !isUsable(element)) continue;
    const score = directionalScore(originRect, element.getBoundingClientRect(), key);
    if (score < bestScore) {
      bestElement = element;
      bestScore = score;
    }
  }

  return bestElement;
}

function focusElement(element) {
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
}

export default function useDpadNavigation() {
  useEffect(() => {
    let focusTimer;
    let lastGridFocusElement = null;

    const focusFirstAvailable = () => {
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && activeElement.isConnected) return;
      focusElement(getFocusableElements(getNavigationRoot(activeElement))[0]);
    };

    const scheduleInitialFocus = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(focusFirstAvailable, 40);
    };

    const handleKeyDown = (event) => {
      const activeElement = document.activeElement;

      if (BACK_KEYS.has(event.key) && !isEditable(activeElement)) {
        event.preventDefault();
        activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }));
        return;
      }

      if ((event.key === "Enter" || event.key === " ")
        && activeElement instanceof HTMLElement
        && activeElement.matches("[role='button'], [data-dpad-focusable]")
        && !event.defaultPrevented) {
        event.preventDefault();
        activeElement.click();
        return;
      }

      if (!DIRECTION_KEYS.has(event.key) || shouldKeepArrowInControl(activeElement, event.key)) return;

      const root = getNavigationRoot(activeElement);
      if (!(activeElement instanceof HTMLElement) || !root.contains(activeElement)) {
        event.preventDefault();
        focusElement(getFocusableElements(root)[0]);
        return;
      }

      const localNavigation = findTopNavNeighbor(activeElement, event.key, lastGridFocusElement)
        || findCategorySidebarNeighbor(activeElement, event.key, lastGridFocusElement)
        || findGridNeighbor(activeElement, event.key);
      let nextElement = localNavigation?.element || null;
      const canLeaveLocalContainer = !localNavigation
        || (!localNavigation.preventFallback
          && (localNavigation.container.hasAttribute("data-dpad-row")
            || event.key === "ArrowLeft"
            || event.key === "ArrowUp"));

      if (!nextElement && localNavigation?.preventFallback) {
        event.preventDefault();
        return;
      }

      if (!nextElement && canLeaveLocalContainer) {
        nextElement = findDirectionalNeighbor(activeElement, event.key, root, localNavigation?.container);
      }

      if (nextElement) {
        event.preventDefault();
        focusElement(nextElement);
      }
    };

    const handleFocusIn = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".iptv-media-grid")) {
        lastGridFocusElement = target;
      }
    };

    const observer = new MutationObserver(() => {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || !activeElement.isConnected) scheduleInitialFocus();
    });

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleInitialFocus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      observer.disconnect();
      window.clearTimeout(focusTimer);
    };
  }, []);
}
