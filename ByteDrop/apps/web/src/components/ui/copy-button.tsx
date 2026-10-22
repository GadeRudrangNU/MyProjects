"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { useToast } from "./toast";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast("Copied to clipboard");
          setTimeout(() => setCopied(false), 1800);
        } catch {
          toast("Could not copy automatically; select the text and copy it.", "error");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}
