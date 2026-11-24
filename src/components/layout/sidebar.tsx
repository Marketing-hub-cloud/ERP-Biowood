"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Boxes, ChevronDown, ClipboardList, Contact, Handshake, PencilRuler, Settings, ShoppingCart, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuSection } from "@/lib/menu";

const ICONS: Record<MenuSection["icon"], typeof Contact> = {
  contacts: Contact,
  crm: Handshake,
  inventory: Boxes,
  engineer: PencilRuler,
  purchase: ShoppingCart,
  users: Users,
  settings: Settings,
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SidebarNav({ menu, onNavigate }: { menu: MenuSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="เมนูหลัก">
      <Link
        href="/"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent",
          pathname === "/" && "bg-sidebar-accent",
        )}
      >
        <ClipboardList className="size-4" /> หน้าแรก
      </Link>
      {menu.map((section) => {
        const Icon = ICONS[section.icon];
        const open = !closed[section.key];
        return (
          <div key={section.key}>
            <button
              type="button"
              onClick={() => setClosed((c) => ({ ...c, [section.key]: open }))}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-sidebar-accent"
              aria-expanded={open}
            >
              <Icon className="size-4" />
              <span className="flex-1">{section.label}</span>
              <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
            </button>
            {open && (
              <ul className="mt-0.5 mb-1 space-y-0.5 pl-6">
                {section.items.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      data-menu-key={item.key}
                      className={cn(
                        "block rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        isActive(pathname, item.href) && "bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** โลโก้บริษัท (public/logo.png สัดส่วน 580×186) */
export function BrandLogo({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="Biowood" width={580} height={186} className={cn("h-9 w-auto", className)} />;
}

/** มุมซ้ายบน: พื้นขาวต่อเนื่องกับ header เพื่อให้โลโก้สีเขียวเห็นชัด */
export function SidebarBrand() {
  return (
    <Link href="/" className="flex h-14 shrink-0 items-center border-r border-b bg-card px-4" aria-label="หน้าแรก">
      <BrandLogo />
    </Link>
  );
}
