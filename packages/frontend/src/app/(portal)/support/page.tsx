'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BookOpen,
  MessageCircle,
  Mail,
  ExternalLink,
  ChevronDown,
  Keyboard,
  Info,
  FileText,
  Github,
} from 'lucide-react';

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

const faqItems: readonly FaqItem[] = [
  {
    question: 'How do I connect to a remote device?',
    answer: 'Navigate to the Dashboard and enter the Device ID in the search bar, then click CONNECT. You can also browse the Devices page and click the connect button next to any online device.',
  },
  {
    question: 'What happens when a session expires?',
    answer: 'Sessions automatically expire after the configured timeout period (default: 24 hours). You will see a warning on the Dashboard when sessions are about to expire. Simply reconnect to create a new session.',
  },
  {
    question: 'How do I add a new device to the system?',
    answer: 'New devices are automatically registered when they connect to the Nucleus agent gateway for the first time. Ensure the device has the Nucleus agent installed and is configured to point to your gateway endpoint.',
  },
  {
    question: 'What ports are available for remote access?',
    answer: 'Nucleus supports forwarding any TCP port. Common services include SSH (22), HTTP (80/443), Node-RED (1880), Cockpit (9090), and Modbus (502). Configure available ports per device in the admin settings.',
  },
  {
    question: 'How do I troubleshoot connection issues?',
    answer: 'First, check the Health page to verify all backend services are running. Then confirm the device is online in the Devices list. If the device appears offline, check its network connection and ensure the Nucleus agent service is running.',
  },
] as const;

const shortcuts: readonly { readonly keys: string; readonly description: string }[] = [
  { keys: 'Ctrl + K', description: 'Quick search / command palette' },
  { keys: 'Ctrl + D', description: 'Go to Dashboard' },
  { keys: 'Ctrl + S', description: 'Go to Sessions' },
  { keys: 'Esc', description: 'Close modal / cancel action' },
  { keys: 'R', description: 'Refresh current page data' },
] as const;

export default function SupportPage() {
  return (
    <div className="min-h-full">
      <PageHeader
        title="Support & Help"
        description="Documentation, frequently asked questions, and contact information"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Docs + FAQ */}
        <div className="lg:col-span-2 space-y-6">
          {/* Documentation Links */}
          <Card>
            <CardHeader>
              <CardTitle>Documentation</CardTitle>
            </CardHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DocLink
                icon={<BookOpen className="w-5 h-5" />}
                title="Getting Started"
                description="Quick start guide for new users"
                href="#"
              />
              <DocLink
                icon={<FileText className="w-5 h-5" />}
                title="API Reference"
                description="REST API documentation"
                href="#"
              />
              <DocLink
                icon={<Github className="w-5 h-5" />}
                title="Source Code"
                description="GitHub repository and changelogs"
                href="#"
              />
              <DocLink
                icon={<Info className="w-5 h-5" />}
                title="Architecture Guide"
                description="System architecture and data flows"
                href="#"
              />
            </div>
          </Card>

          {/* FAQ */}
          <Card>
            <CardHeader>
              <CardTitle>Frequently Asked Questions</CardTitle>
            </CardHeader>
            <div className="space-y-1">
              {faqItems.map((item, index) => (
                <FaqAccordion key={index} question={item.question} answer={item.answer} />
              ))}
            </div>
          </Card>
        </div>

        {/* Right column: Contact + Shortcuts + Version */}
        <div className="space-y-6">
          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Support</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              <ContactItem
                icon={<Mail className="w-4 h-4" />}
                label="Email"
                value="support@tyrion-integration.com"
                href="mailto:support@tyrion-integration.com"
              />
              <ContactItem
                icon={<MessageCircle className="w-4 h-4" />}
                label="Slack Channel"
                value="#nucleus-support"
                href="#"
              />
            </div>
          </Card>

          {/* Keyboard Shortcuts */}
          <Card>
            <CardHeader>
              <CardTitle>Keyboard Shortcuts</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              {shortcuts.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-center justify-between">
                  <span className="text-sm text-on-surface-variant">{shortcut.description}</span>
                  <kbd className="px-2 py-0.5 rounded bg-surface-container-high text-xs font-technical text-on-surface border border-outline-variant/20">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </Card>

          {/* System Version */}
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              <InfoRow label="Portal Version" value="1.0.0" />
              <InfoRow label="API Version" value="1.0.0" />
              <InfoRow label="Agent Protocol" value="v2" />
              <InfoRow label="Environment" value={process.env.NODE_ENV ?? 'development'} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Doc Link ── */

function DocLink({
  icon,
  title,
  description,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-start gap-3 p-4 rounded-lg bg-surface-container-high hover:bg-surface-bright transition-colors group"
    >
      <div className="text-primary mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors">
            {title}
          </span>
          <ExternalLink className="w-3 h-3 text-on-surface-variant/40 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-xs text-on-surface-variant mt-0.5">{description}</p>
      </div>
    </a>
  );
}

/* ── FAQ Accordion ── */

function FaqAccordion({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-outline-variant/10 last:border-0">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-between w-full py-4 text-left group"
      >
        <span className="text-sm font-medium text-on-surface group-hover:text-primary transition-colors pr-4">
          {question}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-on-surface-variant flex-shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="pb-4 pr-8">
          <p className="text-sm text-on-surface-variant leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

/* ── Contact Item ── */

function ContactItem({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a href={href} className="flex items-center gap-3 group">
      <div className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant group-hover:text-primary transition-colors">
        {icon}
      </div>
      <div>
        <p className="text-xs text-on-surface-variant">{label}</p>
        <p className="text-sm text-on-surface group-hover:text-primary transition-colors">{value}</p>
      </div>
    </a>
  );
}

/* ── Info Row ── */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-on-surface-variant">{label}</span>
      <span className="text-sm font-technical text-on-surface">{value}</span>
    </div>
  );
}
