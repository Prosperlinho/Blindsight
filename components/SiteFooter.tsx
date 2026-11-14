import Image from "next/image";
import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/privacy", label: "Privacy" },
  { href: "https://github.com/Prosperlinho/Blindsight", label: "GitHub", external: true },
] as const;

export default function SiteFooter({ className = "max-w-6xl" }: { className?: string }) {
  return (
    <footer
      className={`mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 px-4 py-5 text-xs text-slate-500 sm:px-6 ${className}`}
    >
      <span className="flex items-center gap-2">
        <Image src="/logo-mark.png" alt="" width={18} height={18} className="size-[18px] object-contain opacity-80" />
        BlindSight · Confidential data marketplace
      </span>
      <nav aria-label="Footer" className="ml-auto">
        <ul className="flex items-center gap-4">
          {FOOTER_LINKS.map((link) => (
            <li key={link.href}>
              {"external" in link ? (
                <a href={link.href} target="_blank" rel="noreferrer" className="transition hover:text-slate-200">
                  {link.label}
                </a>
              ) : (
                <Link href={link.href} className="transition hover:text-slate-200">
                  {link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
