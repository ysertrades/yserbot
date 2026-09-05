<script lang="ts">
  import { tick } from 'svelte';
  import { observeTextSize } from '../../text-autosize';
  let { label, value, onChange, placeholder } = $props<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }>();

  function autosize(input: HTMLTextAreaElement, _content: [string, string | undefined]) {
    const size = observeTextSize(input);
    // Actions update before the textarea's value property; measure after the DOM flush.
    const update = () => { void tick().then(size.update); };
    update();
    return { update, destroy: size.destroy };
  }
</script>

<label class="dialkit-text-control">
  <span class="dialkit-text-label">{label}</span>
  <textarea
    use:autosize={[value, placeholder]}
    rows={1}
    class="dialkit-text-input"
    value={value}
    placeholder={placeholder}
    oninput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>
</label>
