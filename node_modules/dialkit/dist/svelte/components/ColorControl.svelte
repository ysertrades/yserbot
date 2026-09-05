<script lang="ts">
  import { onMount } from 'svelte';
  import { mountColorControl, type ColorControlProps } from '../../color-control';
  let { label, value, onChange }: ColorControlProps = $props();
  let host: HTMLDivElement;
  let control: ReturnType<typeof mountColorControl> | undefined;
  onMount(() => {
    control = mountColorControl(host, { label, value, onChange });
    return () => control?.destroy();
  });
  $effect(() => { const next = { label, value, onChange }; control?.update(next); });
</script>

<div bind:this={host} class="dialkit-color-host"></div>
