interface Props {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function Switch({ checked, label, disabled, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}
