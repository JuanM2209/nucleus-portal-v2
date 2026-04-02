'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Copy, Check, X, Terminal, Download, ArrowRight } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/cn';

/* ─── Types ─── */

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  port: number;
  serviceName: string | null;
  sessionToken: string;
  wsUrl: string;
}

type Tab = 'npx' | 'download';

/* ─── Port-specific instructions ─── */

function getConnectInstruction(port: number, localPort: number, serviceName: string | null): string {
  const lp = localPort || port;
  const lower = (serviceName ?? '').toLowerCase();

  if (port === 502 || lower.includes('modbus')) return `Then connect Modbus Poll to localhost:${lp}`;
  if (port === 22 || lower.includes('ssh')) return `Then SSH into localhost:${lp} with your credentials`;
  if (port === 80 || port === 8080 || port === 3000 || lower.includes('http') || lower.includes('web'))
    return `Then open http://localhost:${lp} in your browser`;
  if (port === 443) return `Then open https://localhost:${lp} in your browser`;
  if (port === 1880 || lower.includes('node-red')) return `Then open Node-RED at http://localhost:${lp}`;
  if (port === 9090 || lower.includes('cockpit')) return `Then open Cockpit at https://localhost:${lp}`;
  if (port === 1883 || lower.includes('mqtt')) return `Then connect your MQTT client to localhost:${lp}`;
  if (port === 4840 || lower.includes('opcua')) return `Then connect your OPC UA client to opc.tcp://localhost:${lp}`;
  if (port === 47808 || lower.includes('bacnet')) return `Then connect your BACnet client to localhost:${lp}`;

  return `Then connect your tool to localhost:${lp}`;
}

/* ─── Component ─── */

export function ExportModal({
  isOpen,
  onClose,
  port,
  serviceName,
  sessionToken,
  wsUrl,
}: ExportModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('npx');
  const [copied, setCopied] = useState(false);
  const [localPort, setLocalPort] = useState<number>(port);
  const [visible, setVisible] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Reset local port when device port changes
  useEffect(() => { setLocalPort(port); }, [port]);

  const useCustomPort = localPort !== port && localPort > 0;
  const npxCommand = useCustomPort
    ? `nucleus-tunnel --token ${sessionToken} --port ${port} --local-port ${localPort}`
    : `nucleus-tunnel --token ${sessionToken} --port ${port}`;
  const instruction = getConnectInstruction(port, localPort, serviceName);

  // Animate open/close
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(npxCommand);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [npxCommand]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div
        className={cn(
          'w-full max-w-lg mx-4 rounded-2xl border border-outline-variant/20 bg-surface-container shadow-2xl transition-all duration-200',
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <h2 className="text-base font-semibold text-on-surface">
              Export to Local Machine
            </h2>
            <p className="text-xs text-on-surface-variant/60 mt-0.5">
              Forward {serviceName || `port ${port}`} to your workstation
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Port mapping row */}
        <div className="px-6 mb-4">
          <div className="flex items-center gap-3 bg-surface-container-low rounded-xl px-4 py-3 border border-outline-variant/10">
            <div className="flex-1">
              <p className="text-[10px] text-on-surface-variant/50 font-bold uppercase tracking-wider mb-1">Device Port</p>
              <span className="font-technical text-sm text-on-surface font-bold">{port}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-primary/60 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] text-on-surface-variant/50 font-bold uppercase tracking-wider mb-1">Local Port</p>
              <input
                type="number"
                value={localPort}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0 && v <= 65535) setLocalPort(v);
                }}
                min={1}
                max={65535}
                className="font-technical text-sm text-on-surface font-bold bg-surface-container-highest rounded-lg px-2 py-1 w-20 focus:outline-none focus:ring-2 focus:ring-primary/40 border border-outline-variant/10"
              />
            </div>
            {useCustomPort && (
              <button
                onClick={() => setLocalPort(port)}
                className="text-[10px] text-on-surface-variant/50 hover:text-primary transition"
                title="Reset to same port"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 mb-4">
          <TabButton
            active={activeTab === 'npx'}
            onClick={() => setActiveTab('npx')}
            icon={<Terminal className="w-3.5 h-3.5" />}
            label="npx Command"
          />
          <TabButton
            active={activeTab === 'download'}
            onClick={() => setActiveTab('download')}
            icon={<Download className="w-3.5 h-3.5" />}
            label="Download Helper"
            badge="BETA"
          />
        </div>

        {/* Tab content */}
        <div className="px-6 pb-6">
          {activeTab === 'npx' && (
            <NpxTab
              command={npxCommand}
              instruction={instruction}
              localPort={localPort}
              copied={copied}
              onCopy={handleCopy}
            />
          )}
          {activeTab === 'download' && <DownloadTab />}
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
        active
          ? 'bg-primary text-on-primary'
          : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-bright',
      )}
    >
      {icon}
      {label}
      {badge && (
        <span className={cn(
          'text-[8px] font-bold uppercase tracking-wider px-1 py-px rounded',
          active ? 'bg-on-primary/20 text-on-primary' : 'bg-amber-400/15 text-amber-400',
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}

function NpxTab({
  command,
  instruction,
  localPort,
  copied,
  onCopy,
}: {
  command: string;
  instruction: string;
  localPort: number;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Step 1 */}
      <div>
        <p className="text-xs font-semibold text-on-surface-variant/60 uppercase tracking-wider mb-2">
          Step 1 &mdash; Run in your terminal
        </p>
        <div className="relative group">
          <pre className="bg-surface-container-low rounded-xl p-4 pr-12 text-sm font-technical text-tertiary overflow-x-auto whitespace-pre-wrap break-all border border-outline-variant/10">
            {command}
          </pre>
          <button
            onClick={onCopy}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:bg-surface-bright transition opacity-60 group-hover:opacity-100"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-tertiary" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        {copied && (
          <p className="text-xs text-tertiary mt-1.5 font-medium">
            Copied to clipboard!
          </p>
        )}
      </div>

      {/* Step 2 (port-specific) */}
      <div>
        <p className="text-xs font-semibold text-on-surface-variant/60 uppercase tracking-wider mb-2">
          Step 2 &mdash; Connect
        </p>
        <div className="bg-surface-container-low rounded-xl p-4 text-sm text-on-surface border border-outline-variant/10">
          {instruction}
        </div>
      </div>

      {/* Requirements note */}
      <p className="text-[11px] text-on-surface-variant/40 leading-relaxed">
        Requires Node.js 18+ and npx (included with npm). The tunnel session is active
        for 60 minutes.
      </p>
    </div>
  );
}

function DownloadTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Download the Nucleus tunnel helper for your platform. No Node.js required.
      </p>

      <div className="space-y-2">
        {[
          { platform: 'Windows (x64)', file: 'nucleus-tunnel-win-x64.exe' },
          { platform: 'macOS (Apple Silicon)', file: 'nucleus-tunnel-darwin-arm64' },
          { platform: 'macOS (Intel)', file: 'nucleus-tunnel-darwin-x64' },
          { platform: 'Linux (x64)', file: 'nucleus-tunnel-linux-x64' },
          { platform: 'Linux (ARM64)', file: 'nucleus-tunnel-linux-arm64' },
        ].map(({ platform, file }) => (
          <button
            key={file}
            disabled
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-surface-container-low border border-outline-variant/10 text-left opacity-50 cursor-not-allowed"
          >
            <div>
              <p className="text-sm font-medium text-on-surface">{platform}</p>
              <p className="text-xs text-on-surface-variant/40 font-technical">{file}</p>
            </div>
            <Download className="w-4 h-4 text-on-surface-variant/40" />
          </button>
        ))}
      </div>

      <p className="text-[11px] text-on-surface-variant/40 leading-relaxed">
        Binary downloads coming soon. Use the npx command in the meantime.
      </p>
    </div>
  );
}
