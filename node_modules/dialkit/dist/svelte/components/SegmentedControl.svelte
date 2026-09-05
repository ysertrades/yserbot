<script lang="ts">
  import { handleSegmentKey, labelSegmentedControl } from '../../control-keyboard';

  export interface SegmentedControlOption<T extends string = string> {
    value: T;
    label: string;
  }

  let { options, value, onChange } = $props<{
    options: SegmentedControlOption[];
    value: string;
    onChange: (value: string) => void;
  }>();

  let containerRef = $state<HTMLDivElement | undefined>(undefined);
  let hasAnimated = false;
  let pillLeft = $state<number | null>(null);
  let pillWidth = $state<number | null>(null);

  function measure() {
    if (!containerRef) return;
    labelSegmentedControl(containerRef);
    const activeButton = containerRef.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!activeButton) return;
    pillLeft = activeButton.offsetLeft;
    pillWidth = activeButton.offsetWidth;
  }

  $effect(() => {
    void value;
    void options.length;
    measure();
  });

  let shouldAnimate = $derived.by(() => {
    if (!hasAnimated) {
      hasAnimated = true;
      return false;
    }
    return true;
  });
</script>

<div class="dialkit-segmented" bind:this={containerRef} role="radiogroup" tabindex="-1" onkeydown={handleSegmentKey}>
  {#if pillLeft !== null && pillWidth !== null}
    <div
      class="dialkit-segmented-pill"
      style:left="{pillLeft}px"
      style:width="{pillWidth}px"
      style:transition={shouldAnimate
        ? 'left 0.2s cubic-bezier(0.25, 1, 0.5, 1), width 0.2s cubic-bezier(0.25, 1, 0.5, 1)'
        : 'none'}
    ></div>
  {/if}

  {#each options as option (option.value)}
    <button
      onclick={() => onChange(option.value)}
      class="dialkit-segmented-button"
      data-active={String(value === option.value)}
      type="button" role="radio" aria-checked={value === option.value} tabindex={value === option.value ? 0 : -1}
    >
      {option.label}
    </button>
  {/each}
</div>
