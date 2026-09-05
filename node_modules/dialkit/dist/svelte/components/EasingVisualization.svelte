<script lang="ts">
  import { onMount } from 'svelte';
  import { mountEasingVisualization, type EasingVisualizationProps } from '../../easing-control';
  import { easingPresets as presets } from '../../easing-geometry';
  export const easingPresets = presets;
  let { easing, onChange }: EasingVisualizationProps = $props();
  let host: HTMLDivElement;
  let control: ReturnType<typeof mountEasingVisualization> | undefined;
  onMount(() => {
    control = mountEasingVisualization(host, { easing, onChange });
    return () => control?.destroy();
  });
  $effect(() => { const next = { easing, onChange }; control?.update(next); });
</script>

<div bind:this={host} class="dialkit-easing-host"></div>
