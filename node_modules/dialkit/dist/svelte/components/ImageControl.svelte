<script lang="ts">
  import { onMount } from 'svelte';
  import { mountImageControl, type ImageControlProps } from '../../image-control';
  let { label, value, options, onChange }: ImageControlProps = $props();
  let host: HTMLDivElement;
  let control: ReturnType<typeof mountImageControl> | undefined;
  onMount(() => {
    control = mountImageControl(host, { label, value, options, onChange });
    return () => control?.destroy();
  });
  $effect(() => { const next = { label, value, options, onChange }; control?.update(next); });
</script>

<div bind:this={host} class="dialkit-image-host"></div>
