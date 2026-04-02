'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Copy, Check, X, Zap, Loader2 } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';

/* ─── Types ─── */

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  port: number;
  serviceName: string | null;
  deviceId: string;
}

interface PortExposure {
  serviceName: string;
  remotePort: number;
  host: string;
  address: string;
}

/* ─── Port-specific tool instructions ─── */

function getToolInstruction(port: number, address: string, serviceName: string | null): string {
  const lower = (serviceName ?? '').toLowerCase();

  if (port === 502 || lower.includes('modbus')) return `Modbus Poll → ${address}`;
  if (port === 22 || lower.includes('ssh')) return `PuTTY / SSH → ${address}`;
  if (port === 80 || port === 8080 || port === 3000 || lower.includes('http') || lower.includes('web'))
    return `Browser → http://${address}`;
  if (port === 443) return `Browser → https://${address}`;
  if (port === 1880 || lower.includes('node-red')) return `Browser → http://${address}`;
  if (port === 9090 || lower.includes('cockpit')) return `Browser → https://${address}`;
  if (port === 1883 || lower.includes('mqtt')) return `MQTT client → ${address}`;
  if (port === 4840 || lower.includes('opcua')) return `OPC UA client → opc.tcp://${address}`;
  if (port === 47808 || lower.includes('bacnet')) return `BACnet client → ${address}`;
  if (port === 2202 || lower.includes('mbusd')) return `Modbus Poll → ${address}`;

  return `Connect your tool → ${address}`;
}

/* ─── Component ─── */

export function ExportModal({
  isOpen,
  onClose,
  port,
  serviceName,
  deviceId,
}: ExportModalProps) {
  const [exposure, setExposure] = useState<PortExposure | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Request port exposure when modal opens
  useEffect(() => {
    if (!isOpen || !deviceId || !port) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setExposure(null);

    api.post<{ success: boolean; data: PortExposure }>(`/devices/${deviceId}/ports/${port}/expose`)
      .then((res) => {
        if (!cancelled && res.data) {
          setExposure(res.data);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to expose port');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, deviceId, port]);

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
    if (!exposure) return;
    const success = await copyToClipboard(exposure.address);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [exposure]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  const address = exposure?.address ?? '';
  const toolInstruction = exposure ? getToolInstruction(port, address, serviceName) : '';

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
              Direct Port Access
            </h2>
            <p className="text-xs text-on-surface-variant/60 mt-0.5">
              {serviceName || `Port ${port}`} — no CLI needed
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {loading && (
            <div className="flex items-center justify-center gap-3 py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <span className="text-sm text-on-surface-variant">Exposing port {port}...</span>
            </div>
          )}

          {error && (
            <div className="bg-error/10 text-error rounded-xl p-4 text-sm">
              {error}
            </div>
          )}

          {exposure && !loading && (
            <div className="space-y-4">
              {/* Address display */}
              <div>
                <p className="text-xs font-semibold text-on-surface-variant/60 uppercase tracking-wider mb-2">
                  Connect directly
                </p>
                <div className="relative group">
                  <div className="bg-surface-container-low rounded-xl p-4 pr-12 border border-outline-variant/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-tertiary" />
                      <span className="text-xs font-bold text-tertiary uppercase">Direct TCP</span>
                    </div>
                    <p className="font-technical text-lg text-on-surface font-bold">
                      {address}
                    </p>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="absolute top-3 right-3 p-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:bg-surface-bright transition opacity-60 group-hover:opacity-100"
                    title="Copy address"
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

              {/* Tool instruction */}
              <div>
                <p className="text-xs font-semibold text-on-surface-variant/60 uppercase tracking-wider mb-2">
                  Connect your tool
                </p>
                <div className="bg-surface-container-low rounded-xl p-4 text-sm text-on-surface border border-outline-variant/10">
                  {toolInstruction}
                </div>
              </div>

              {/* Info note */}
              <p className="text-[11px] text-on-surface-variant/40 leading-relaxed">
                No CLI or Node.js required. Connect directly from any tool.
                Port allocation expires after 24 hours of inactivity.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
