import { useEffect, useState } from "react";

function read(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

export function useHash(): string {
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const onChange = () => setHash(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function navigate(path: string): void {
  window.location.hash = path;
}
