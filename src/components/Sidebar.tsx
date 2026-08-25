"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  CalendarClock,
  CalendarRange,
  GanttChartSquare,
  ListPlus,
  Bug,
  MessageSquareQuote,
  ShieldCheck,
  ClipboardCheck,
  FileBarChart,
  FileStack,
  ReceiptIndianRupee,
  Wallet,
  Upload,
  Users,
  Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import styles from "./sidebar.module.css";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  hidden?: boolean;         // conditional visibility (permissions)
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface SidebarProps {
  projectId: string;
  canAccessBilling: boolean;
  canLogExpense: boolean;
  canImport: boolean;      // admin only
  canManageUsers: boolean; // admin only
}

/**
 * Left slide-out sidebar. Replaces the horizontal row of action pills that
 * used to sit under the project header. Groups links by concern so users
 * scan by category, not by name.
 *
 * State: local to this component (open/closed). Automatically closes on
 * navigation because usePathname changes trigger the effect below.
 */
export default function Sidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-close on route change (Link navigation).
  useEffect(() => { setOpen(false); }, [pathname]);

  // Escape + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
      openBtnRef.current?.focus?.();
    };
  }, [open]);

  const groups: NavGroup[] = [
    {
      title: "Schedule",
      items: [
        { label: "Timeline",   href: `/projects/${props.projectId}/timeline`,   icon: CalendarRange },
        { label: "Look-ahead", href: `/projects/${props.projectId}/look-ahead`, icon: CalendarClock },
        { label: "Gantt",      href: `/projects/${props.projectId}/gantt`,      icon: GanttChartSquare },
      ],
    },
    {
      title: "Data entry",
      items: [
        { label: "Add Progress",    href: `/projects/${props.projectId}/add-progress`, icon: ListPlus },
        { label: "Manpower",        href: `/projects/${props.projectId}/manpower`,     icon: Users },
        { label: "Import schedule", href: `/projects/${props.projectId}/import-msp`,   icon: Upload, hidden: !props.canImport },
      ],
    },
    {
      title: "Records",
      items: [
        { label: "Snag Master", href: `/projects/${props.projectId}/snags`,   icon: Bug },
        { label: "RFI",         href: `/projects/${props.projectId}/rfi`,     icon: MessageSquareQuote },
        { label: "Permits",     href: `/projects/${props.projectId}/permits`, icon: ShieldCheck },
      ],
    },
    {
      title: "Reports & Docs",
      items: [
        { label: "DLR",      href: `/projects/${props.projectId}/dlr`,      icon: ClipboardCheck },
        { label: "Reports",  href: `/projects/${props.projectId}/reports`,  icon: FileBarChart },
        { label: "Drawings", href: `/projects/${props.projectId}/drawings`, icon: FileStack },
      ],
    },
    {
      title: "Finance",
      items: [
        { label: "Billing",  href: `/projects/${props.projectId}/bills`,    icon: ReceiptIndianRupee, hidden: !props.canAccessBilling },
        { label: "Expenses", href: `/projects/${props.projectId}/expenses`, icon: Wallet, hidden: !props.canLogExpense },
      ],
    },
  ];

  // Admin group appears only for admins.
  if (props.canManageUsers) {
    groups.push({
      title: "Admin",
      items: [
        { label: "Users",       href: `/admin/users`,       icon: UsersIcon },
        { label: "Contractors", href: `/admin/contractors`, icon: UsersIcon },
      ],
    });
  }

  const visibleGroups = groups.filter((g) => g.items.some((i) => !i.hidden));

  return (
    <>
      <button
        ref={openBtnRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label="Open project menu"
        aria-expanded={open}
        aria-controls="project-sidebar"
      >
        <Menu className={styles.triggerIcon} />
        <span className={styles.triggerLabel}>Menu</span>
      </button>

      <div
        className={`${styles.scrim} ${open ? styles.scrimOpen : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        id="project-sidebar"
        className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Project menu"
        aria-hidden={!open}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>Menu</div>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.closeBtn}
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className={styles.closeIcon} />
          </button>
        </div>

        <nav className={styles.body}>
          {visibleGroups.map((group) => (
            <div key={group.title} className={styles.group}>
              <div className={styles.groupTitle}>{group.title}</div>
              <ul className={styles.list}>
                {group.items.filter((i) => !i.hidden).map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`${styles.link} ${active ? styles.linkActive : ""}`}
                      >
                        <Icon className={styles.linkIcon} />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
