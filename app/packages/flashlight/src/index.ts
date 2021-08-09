/**
 * Copyright 2017-2021, Voxel51, Inc.
 */

import { MARGIN, NUM_ROWS_PER_SECTION } from "./constants";
import SectionElement from "./section";
import {
  Get,
  ItemData,
  OnItemClick,
  OnResize,
  OnItemResize,
  Optional,
  Options,
  Render,
  RowData,
  State,
} from "./state";
import { createScrollReader } from "./zooming";

import {
  flashlight,
  flashlightContainer,
  flashlightPixels,
} from "./styles.module.css";
import tile from "./tile";
import { argMin } from "./util";

export interface FlashlightOptions extends Optional<Options> {}

export interface FlashlightConfig<K> {
  get: Get<K>;
  render: Render;
  initialRequestKey: K;
  options: FlashlightOptions;
  onItemClick?: OnItemClick;
  onResize?: OnResize;
  onItemResize?: OnItemResize;
}

export default class Flashlight<K> {
  private loading: boolean = false;
  private container: HTMLDivElement;
  private element: HTMLDivElement;
  private state: State<K>;
  private resizeObserver: ResizeObserver;
  private readonly config: FlashlightConfig<K>;
  private pixelsSet: boolean;
  private ctx: number = 0;

  constructor(config: FlashlightConfig<K>) {
    this.config = config;
    this.container = this.createContainer();
    this.showPixels();
    this.element = document.createElement("div");
    this.element.classList.add(flashlight);
    this.state = this.getEmptyState(config);

    let attached = false;

    let frame = null;

    document.addEventListener("visibilitychange", () => this.render());

    this.resizeObserver = new ResizeObserver(
      ([
        {
          contentRect: { width, height },
        },
      ]: ResizeObserverEntry[]) => {
        this.state.containerHeight = height;
        if (!attached) {
          attached = true;
          return;
        }

        width = width - 16;
        frame && clearTimeout(frame);
        frame = requestAnimationFrame(() => {
          const options =
            this.state.width !== width && this.state.onResize
              ? this.state.onResize(width)
              : {};

          const force = this.state.width !== width;
          this.state.width = width;

          this.updateOptions(options, force);
          frame = null;
        });
      }
    );

    createScrollReader(
      this.element,
      (zooming) => this.render(zooming),
      () => {
        return (
          ((this.state.options.rowAspectRatioThreshold * this.state.width) /
            this.state.containerHeight) *
          20
        );
      }
    );

    this.element.appendChild(this.container);
  }

  reset() {
    this.ctx++;
    this.loading = false;
    const newContainer = this.createContainer();
    this.container.replaceWith(newContainer);
    this.container = newContainer;
    this.state = this.getEmptyState(this.config);
    this.showPixels();

    const {
      width,
      height,
    } = this.container.parentElement.getBoundingClientRect();
    this.state.width = width - 16;
    this.state.containerHeight = height;

    this.get();
  }

  isAttached() {
    return Boolean(this.container.parentElement);
  }
  private showPixels() {
    !this.pixelsSet && this.container.classList.add(flashlightPixels);
    this.pixelsSet = true;
  }

  private hidePixels() {
    this.pixelsSet && this.container.classList.remove(flashlightPixels);
    this.pixelsSet = false;
  }

  attach(element: HTMLElement | string): void {
    if (typeof element === "string") {
      element = document.getElementById(element);
    }

    const { width, height } = element.getBoundingClientRect();
    this.state.width = width - 16;
    this.state.containerHeight = height;

    const options =
      this.state.width !== width && this.state.onResize
        ? this.state.onResize(width)
        : {};

    element.appendChild(this.element);

    this.resizeObserver.observe(element);

    this.updateOptions(options);

    this.get();
  }

  updateOptions(options: Optional<Options>, force: boolean = false) {
    const retile = Object.entries(options).some(
      ([k, v]) => this.state.options[k] != v
    );

    this.state.options = {
      ...this.state.options,
      ...options,
    };

    if ((retile || force) && this.state.sections.length) {
      this.state.resized = new Set();
      const newContainer = this.createContainer();
      this.container.replaceWith(newContainer);
      this.container = newContainer;
      const items = [
        ...this.state.sections.map((section) => section.getItems()).flat(),
        ...this.state.currentRowRemainder.map(({ items }) => items).flat(),
      ];
      const active = this.state.activeSection;
      console.log(active, this.state.sections[active].itemIndex);
      const activeItemIndex = this.state.sections[active].itemIndex;
      let sections = this.tile(items);

      const lastSection = sections[sections.length - 1];
      if (
        sections.length &&
        Boolean(this.state.currentRequestKey) &&
        lastSection.length !== NUM_ROWS_PER_SECTION
      ) {
        this.state.currentRowRemainder = lastSection;
        sections = sections.slice(0, -1);
      } else {
        this.state.currentRowRemainder = [];
      }

      this.state.height = 0;
      this.state.sections = [];
      this.state.shownSections = new Set();
      this.state.clean = new Set();

      sections.forEach((rows, index) => {
        const sectionElement = new SectionElement(
          index,
          this.state.itemIndexMap[rows[0].items[0].id],
          rows,
          this.state.render,
          this.getOnItemClick()
        );
        sectionElement.set(this.state.height, this.state.width);
        this.state.sections.push(sectionElement);

        this.state.height += sectionElement.getHeight();
      });
      newContainer.style.height = `${this.state.height}px`;

      for (const section of this.state.sections) {
        if (section.itemIndex >= activeItemIndex) {
          this.container.parentElement.scrollTo(0, section.getTop());
          this.render();
          return;
        }
      }
    }
  }

  updateItems(updater: (id: string) => void) {
    this.state.clean = new Set();
    this.state.shownSections.forEach((index) => {
      const section = this.state.sections[index];
      section
        .getItems()
        .map(({ id }) => id)
        .forEach((id) => updater(id));
    });
    this.state.updater = updater;
  }

  get(): Promise<void> | null {
    if (this.loading || this.state.currentRequestKey === null) {
      return null;
    }

    this.loading = true;
    let ctx = this.ctx;
    return this.state
      .get(this.state.currentRequestKey)
      .then(({ items, nextRequestKey }) => {
        if (ctx !== this.ctx) {
          return;
        }

        this.state.currentRequestKey = nextRequestKey;

        for (const { id } of items) {
          this.state.itemIndexMap[id] = this.state.nextItemIndex;
          this.state.nextItemIndex++;
        }

        items = [...this.state.currentRemainder, ...items];

        let sections = this.tile(items, true);

        const lastSection = sections[sections.length - 1];
        if (
          Boolean(nextRequestKey) &&
          lastSection &&
          lastSection.length !== NUM_ROWS_PER_SECTION
        ) {
          this.state.currentRowRemainder = lastSection;
          sections = sections.slice(0, -1);
        } else {
          this.state.currentRowRemainder = [];
        }

        sections.forEach((rows) => {
          const sectionElement = new SectionElement(
            this.state.sections.length,
            this.state.itemIndexMap[rows[0].items[0].id],
            rows,
            this.state.render,
            this.getOnItemClick()
          );
          sectionElement.set(this.state.height, this.state.width);
          this.state.sections.push(sectionElement);

          this.state.height += sectionElement.getHeight();
          this.state.clean.add(sectionElement.index);
        });

        if (sections.length) {
          this.container.style.height = `${this.state.height}px`;
        }

        const headSection = this.state.sections[this.state.sections.length - 1];

        this.state.currentRequestKey = nextRequestKey;
        this.loading = false;

        if (
          this.state.height <= this.state.containerHeight ||
          (!sections.length && nextRequestKey) ||
          (headSection && this.state.shownSections.has(headSection.index))
        ) {
          this.requestMore();
        }

        if (
          this.state.height >= this.state.containerHeight ||
          nextRequestKey === null
        ) {
          this.hidePixels();
        }
      });
  }

  private requestMore() {
    if (this.state.currentRequestKey) {
      this.get();
    }
  }

  private hideSection(index: number) {
    const section = this.state.sections[index];
    if (!section || !section.isShown()) {
      return;
    }

    section.hide();
    this.state.shownSections.delete(section.index);
  }

  private showSections(zooming: boolean) {
    const hidden = zooming && this.shownSectionsNeedUpdate();
    this.state.shownSections.forEach((index) => {
      const section = this.state.sections[index];
      if (!section) {
        return;
      }
      let shown = false;
      if (
        this.state.resized &&
        !this.state.resized.has(section.index) &&
        !hidden
      ) {
        this.state.onItemResize && section.resizeItems(this.state.onItemResize);
        this.state.resized.add(section.index);
        shown = true;
      }

      if (!this.state.clean.has(section.index) && !hidden) {
        this.state.updater &&
          section
            .getItems()
            .map(({ id }) => id)
            .forEach((id) => this.state.updater(id));
        this.state.clean.add(section.index);
        shown = true;
      }
      section.show(this.container, hidden, zooming);
      this.state.shownSections.add(section.index);
    });
  }

  private render(zooming: boolean = false) {
    if (
      this.state.sections.length === 0 &&
      this.state.currentRequestKey === null
    ) {
      this.hidePixels();
      return;
    }

    const top = this.element.scrollTop;

    const index = argMin(
      this.state.sections.map((section) => Math.abs(section.getTop() - top))
    );

    this.state.firstSection = Math.max(index - 2, 0);
    let revealing = this.state.sections[this.state.firstSection];
    let revealingIndex = this.state.firstSection;

    while (
      revealing &&
      revealing.getTop() <= top + this.state.containerHeight
    ) {
      revealingIndex = revealing.index + 1;
      revealing = this.state.sections[revealingIndex];
    }

    this.state.lastSection = !revealing ? revealingIndex - 1 : revealingIndex;

    this.state.activeSection = this.state.firstSection;
    let activeSection = this.state.sections[this.state.activeSection];

    if (!activeSection) {
      return;
    }

    while (activeSection.getBottom() - MARGIN <= top) {
      if (this.state.sections[this.state.activeSection + 1]) {
        this.state.activeSection += 1;
        activeSection = this.state.sections[this.state.activeSection];
      } else break;
    }

    let i = this.state.firstSection;
    while (i <= this.state.lastSection) {
      this.state.shownSections.add(i);
      i++;
    }
    [...Array.from(this.state.shownSections)].forEach((index) => {
      if (index < this.state.firstSection || index > this.state.lastSection) {
        this.hideSection(index);
      }
    });

    this.showSections(zooming);

    if (this.state.lastSection === this.state.sections.length - 1) {
      this.requestMore();
    }

    requestAnimationFrame(() => this.render());
  }

  private shownSectionsNeedUpdate() {
    let needsUpdate = false;
    this.state.shownSections.forEach((index) => {
      const section = this.state.sections[index];
      if (this.state.resized && !this.state.resized.has(section.index)) {
        needsUpdate = true;
      }

      if (this.state.updater && !this.state.clean.has(section.index)) {
        needsUpdate = true;
      }
    });

    return needsUpdate;
  }

  private tile(items: ItemData[], useRowRemainder = false): RowData[][] {
    let { rows, remainder } = tile(
      items,
      this.state.options.rowAspectRatioThreshold,
      Boolean(this.state.currentRequestKey)
    );

    this.state.currentRemainder = remainder;

    if (useRowRemainder) {
      rows = [...this.state.currentRowRemainder, ...rows];
    }

    return new Array(Math.ceil(rows.length / NUM_ROWS_PER_SECTION))
      .fill(0)
      .map((_) => rows.splice(0, NUM_ROWS_PER_SECTION));
  }

  private getEmptyState(config: FlashlightConfig<K>): State<K> {
    return {
      currentRequestKey: config.initialRequestKey,
      containerHeight: null,
      width: null,
      height: 0,
      ...config,
      currentRemainder: [],
      currentRowRemainder: [],
      items: [],
      sections: [],
      activeSection: 0,
      firstSection: 0,
      lastSection: 0,
      options: {
        rowAspectRatioThreshold: 5,
        ...config.options,
      },
      clean: new Set(),
      shownSections: new Set(),
      onItemClick: config.onItemClick,
      onItemResize: config.onItemResize,
      onResize: config.onResize,
      itemIndexMap: {},
      nextItemIndex: 0,
      resized: null,
    };
  }

  private getOnItemClick(): (event: MouseEvent, id: string) => void | null {
    if (!this.state.onItemClick) {
      return null;
    }

    return (event, id) =>
      this.state.onItemClick(event, id, { ...this.state.itemIndexMap });
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.classList.add(flashlightContainer);
    container.tabIndex = -1;
    container.addEventListener("mouseenter", () => container.focus());
    container.removeEventListener("mouseleaver", () => container.blur());

    return container;
  }
}
