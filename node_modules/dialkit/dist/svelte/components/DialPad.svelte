<script lang="ts">
  import { onMount } from 'svelte';
  import { mountDialPad, type DialPadProps } from '../../dial-pad-control';
  let { label, value, x, y, labels, onChange }: DialPadProps = $props();
  let host: HTMLDivElement;
  let control: ReturnType<typeof mountDialPad> | undefined;
  onMount(() => {
    control = mountDialPad(host, { label, value, x, y, labels, onChange });
    return () => control?.destroy();
  });
  $effect(() => { const next = { label, value, x, y, labels, onChange }; control?.update(next); });
</script>

<div bind:this={host} class="dialkit-pad-host"></div>
