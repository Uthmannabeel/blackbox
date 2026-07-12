"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { REPO } from "@/lib/demoData";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/architecture", label: "Architecture" },
  { href: "/survivability", label: "Survivability" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="brand" aria-label="BlackBox home">
          <span className="mark">
            Black<b>Box</b>
          </span>
          <span className="tag">incident memory</span>
        </Link>
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href ? "active hide-sm" : "hide-sm"}>
              {l.label}
            </Link>
          ))}
          <a href={REPO}>GitHub</a>
        </div>
        <div className="nav-right">
          <ThemeToggle />
          <Link href="/console" className="btn btn-primary btn-sm">
            Open console
          </Link>
        </div>
      </div>
    </nav>
  );
}
