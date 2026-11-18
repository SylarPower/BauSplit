import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  convertToBaseAmount,
  getGroupTransferTargets,
} from '../lib/accounting';
import {
  CUSTOM_CATEGORY_COLORS,
  CUSTOM_CATEGORY_ICONS,
} from '../lib/categories';
import {
  fetchExchangeRate,
  formatMoney,
  formatRateValue,
  parseDecimalInput,
} from '../lib/currencies';
import { formatFullDateIT, todayISO } from '../lib/dates';
import { translateErrorIT } from '../lib/supabase';
import type {
  CustomCategory,
  ExpenseGroup,
  GroupMember,
  GroupOverview,
  MemberBalance,
  SimplifiedTransfer,
} from '../types';
import { Avatar, CategoryIcon } from './Icon';
import { Modal } from './Modal';

interface GroupSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialFocusClose?: boolean;
  group: ExpenseGroup;
  allGroups: GroupOverview[];
  members: GroupMember[];
  balances: MemberBalance[];
  transfers: SimplifiedTransfer[];
  customCategories: CustomCategory[];
  currentUserId: string;
  onUpdateGroup: (name: string, description: string) => Promise<void>;
  onAddCategory: (params: {
    name: string;
    icon: string;
    color: string;
  }) => Promise<CustomCategory>;
  onDeleteCategory: (cat: CustomCategory) => Promise<void>;
  onCloseGroup: (params: {
    targetGroup: ExpenseGroup | null;
    exchangeRate: number;
    rateDate: string;
    rateIsManual: boolean;
  }) => Promise<void>;
  onReopenGroup: () => Promise<void>;
  onLeaveGroup: () => Promise<void>;
  onToast: (msg: string, isError?: boolean) => void;
}

export function GroupSettingsModal({
  open,
  onClose,
  initialFocusClose = false,
  group,
  allGroups,
  members,
  balances,
  transfers,
  customCategories,
  currentUserId,
  onUpdateGroup,
  onAddCategory,
  onDeleteCategory,
  onCloseGroup,
  onReopenGroup,
  onLeaveGroup,
  onToast,
}: GroupSettingsModalProps) {
  const isClosed = group.closedAt !== null;

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [savingGroup, setSavingGroup] = useState(false);

  const [catName, setCatName] = useState('');
  const [catIcon, setCatIcon] = useState('tag');
  const [catColor, setCatColor] = useState(CUSTOM_CATEGORY_COLORS[0]);
  const [addingCat, setAddingCat] = useState(false);

  // Chiusura gruppo e trasferimento saldo rimanente
  const [showClosePanel, setShowClosePanel] = useState(false);
  const [closeMode, setCloseMode] = useState<'transfer' | 'keep'>('transfer');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [fxStr, setFxStr] = useState('1');
  const [fxDate, setFxDate] = useState(todayISO());
  const [fxManual, setFxManual] = useState(false);
  const [loadingFx, setLoadingFx] = useState(false);
  const [closingBusy, setClosingBusy] = useState(false);

  // Uscita dal gruppo (consentita anche con saldo diverso da zero)
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const nameMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName])),
    [members]
  );
  const nameOf = (uid: string) => nameMap.get(uid) ?? 'Membro';

  const transferTargets = useMemo(
    () =>
      getGroupTransferTargets({
        sourceGroupId: group.id,
        transfers,
        allGroups,
        nameOf,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group.id, transfers, allGroups, nameMap]
  );

  useEffect(() => {
    if (open) {
      setName(group.name);
      setDescription(group.description);
      setConfirmLeave(false);
      setCatName('');
      setShowClosePanel(initialFocusClose);
      if (transfers.length > 0 && transferTargets.eligible.length > 0) {
        setCloseMode('transfer');
        setTargetGroupId(transferTargets.eligible[0].group.id);
      } else {
        setCloseMode('keep');
        setTargetGroupId(transferTargets.eligible[0]?.group.id ?? '');
      }
      setFxStr('1');
      setFxDate(todayISO());
      setFxManual(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group.id, initialFocusClose]);

  const selectedTargetGroup: ExpenseGroup | null = useMemo(() => {
    if (transfers.length === 0 || closeMode !== 'transfer' || !targetGroupId) return null;
    return transferTargets.eligible.find((g) => g.group.id === targetGroupId)?.group ?? null;
  }, [transfers.length, closeMode, targetGroupId, transferTargets.eligible]);

  const needsFx =
    selectedTargetGroup !== null && selectedTargetGroup.baseCurrency !== group.baseCurrency;

  useEffect(() => {
    if (!open || !showClosePanel || !selectedTargetGroup) return;
    if (selectedTargetGroup.baseCurrency === group.baseCurrency) {
      setFxStr('1');
      setFxDate(todayISO());
      setFxManual(false);
      return;
    }
    if (fxManual) return;

    let cancelled = false;
    setLoadingFx(true);
    fetchExchangeRate(group.baseCurrency, selectedTargetGroup.baseCurrency)
      .then((res) => {
        if (cancelled) return;
        setFxStr(String(res.rate).replace('.', ','));
        setFxDate(res.effectiveDate);
      })
      .finally(() => {
        if (!cancelled) setLoadingFx(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, showClosePanel, selectedTargetGroup, group.baseCurrency, fxManual]);

  const parsedFx = useMemo(() => {
    if (!needsFx) return 1;
    const v = parseDecimalInput(fxStr);
    return v !== null && v > 0 ? v : 0;
  }, [needsFx, fxStr]);

  const activeMembers = members.filter((m) => m.leftAt === null);
  const myBalance = balances.find((b) => b.userId === currentUserId)?.netBalance ?? 0;
  const hasNonZeroMyBalance = Math.abs(myBalance) >= 0.01;

  const handleSaveGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingGroup(true);
    try {
      await onUpdateGroup(name.trim(), description.trim());
      onToast('Impostazioni gruppo aggiornate');
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setSavingGroup(false);
    }
  };

  const handleCreateCat = async (e: FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    setAddingCat(true);
    try {
      await onAddCategory({ name: catName.trim(), icon: catIcon, color: catColor });
      setCatName('');
      onToast('Categoria personalizzata aggiunta');
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setAddingCat(false);
    }
  };

  const handleDeleteCat = async (cat: CustomCategory) => {
    try {
      await onDeleteCategory(cat);
      onToast(`Categoria "${cat.name}" rimossa`);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    }
  };

  const handleConfirmCloseGroup = async () => {
    if (transfers.length > 0 && closeMode === 'transfer') {
      if (!selectedTargetGroup) {
        onToast('Seleziona il gruppo in cui spostare il saldo.', true);
        return;
      }
      if (needsFx && parsedFx <= 0) {
        onToast('Inserisci un tasso di cambio valido maggiore di zero.', true);
        return;
      }
    }

    setClosingBusy(true);
    try {
      await onCloseGroup({
        targetGroup: transfers.length > 0 && closeMode === 'transfer' ? selectedTargetGroup : null,
        exchangeRate: needsFx ? parsedFx : 1,
        rateDate: fxDate,
        rateIsManual: needsFx ? fxManual : false,
      });
      onClose();
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setClosingBusy(false);
    }
  };

  const handleReopen = async () => {
    setClosingBusy(true);
    try {
      await onReopenGroup();
      onClose();
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setClosingBusy(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await onLeaveGroup();
      onClose();
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setLeaving(false);
    }
  };

  const groupUnchanged =
    name.trim() === group.name && description.trim() === group.description;

  return (
    <Modal
      open={open}
      title={initialFocusClose && !isClosed ? 'Chiudi gruppo' : 'Impostazioni del gruppo'}
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Chiudi
        </button>
      }
    >
      <div className="form-stack">
        {/* Sezione Chiusura / Riapertura gruppo e spostamento saldo rimanente */}
        <div className="field">
          <div style={{ fontSize: 14, fontWeight: 650 }}>
            {isClosed ? 'Stato del gruppo' : 'Chiusura del gruppo e saldo rimanente'}
          </div>

          {isClosed ? (
            <div className="fx-box">
              <div style={{ fontSize: 13.5 }}>
                Questo gruppo è stato chiuso il{' '}
                <strong>{formatFullDateIT(group.closedAt!.slice(0, 10))}</strong>
                {group.closedIntoGroupName && (
                  <>
                    {' '}
                    spostando il saldo rimanente in{' '}
                    <strong>&ldquo;{group.closedIntoGroupName}&rdquo;</strong>
                  </>
                )}
                . Le spese, gli Insights e lo storico restano consultabili ed esportabili in CSV.
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleReopen}
                  disabled={closingBusy}
                >
                  <ArchiveRestore size={14} />
                  {closingBusy ? 'Riapertura…' : 'Riapri gruppo'}
                </button>
              </div>
            </div>
          ) : !showClosePanel ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span className="field-hint">
                {transfers.length > 0
                  ? 'Chiudi il gruppo e sposta automaticamente il saldo rimanente in un altro gruppo condiviso.'
                  : 'I conti sono in pari: puoi chiudere il gruppo mantenendone lo storico in sola lettura.'}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (transfers.length > 0 && transferTargets.eligible.length > 0) {
                    setCloseMode('transfer');
                    if (!targetGroupId) {
                      setTargetGroupId(transferTargets.eligible[0].group.id);
                    }
                  }
                  setShowClosePanel(true);
                }}
              >
                <Archive size={14} />
                Chiudi gruppo…
              </button>
            </div>
          ) : (
            <div className="fx-box" style={{ gap: 12 }}>
              {transfers.length === 0 ? (
                <div style={{ fontSize: 13.5 }}>
                  Tutti i saldi sono già pari a zero. Chiudendo <strong>{group.name}</strong> non
                  verranno aggiunte nuove spese (ricorrenze e link d&apos;invito verranno
                  disattivati), ma potrai sempre consultare spese, Insights e CSV o riaprirlo in
                  seguito.
                </div>
              ) : (
                <>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                      Saldo rimanente da sistemare:
                    </div>
                    <div className="split-list">
                      {transfers.map((tr) => (
                        <div
                          key={`${tr.fromUser}-${tr.toUser}`}
                          className="split-row tabular"
                          style={{ fontSize: 13.5 }}
                        >
                          <span>
                            <strong>{tr.fromName}</strong> deve a <strong>{tr.toName}</strong>
                          </span>
                          <span style={{ fontWeight: 650 }}>
                            {formatMoney(tr.amount, group.baseCurrency)}
                            {needsFx && selectedTargetGroup && parsedFx > 0 && (
                              <span className="text-muted" style={{ fontWeight: 450 }}>
                                {' '}
                                (
                                <ArrowRight
                                  size={11}
                                  style={{ verticalAlign: 'middle', margin: '0 2px' }}
                                />
                                {formatMoney(
                                  convertToBaseAmount(
                                    tr.amount,
                                    group.baseCurrency,
                                    parsedFx,
                                    selectedTargetGroup.baseCurrency
                                  ),
                                  selectedTargetGroup.baseCurrency
                                )}
                                )
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {transferTargets.eligible.length > 0 ? (
                    <>
                      <div className="segmented">
                        <button
                          type="button"
                          className={`segmented-btn ${closeMode === 'transfer' ? 'active' : ''}`}
                          onClick={() => setCloseMode('transfer')}
                        >
                          Sposta in un altro gruppo
                        </button>
                        <button
                          type="button"
                          className={`segmented-btn ${closeMode === 'keep' ? 'active' : ''}`}
                          onClick={() => setCloseMode('keep')}
                        >
                          Non spostare il saldo
                        </button>
                      </div>

                      {closeMode === 'transfer' ? (
                        <div className="form-stack" style={{ gap: 10 }}>
                          <label className="field">
                            <span className="field-label">Gruppo di destinazione</span>
                            <select
                              className="select select-sm"
                              value={targetGroupId}
                              onChange={(e) => {
                                setFxManual(false);
                                setTargetGroupId(e.target.value);
                              }}
                            >
                              {transferTargets.eligible.map((ov) => (
                                <option key={ov.group.id} value={ov.group.id}>
                                  {ov.group.name} ({ov.group.baseCurrency} ·{' '}
                                  {ov.members.map((m) => m.displayName).join(', ')})
                                </option>
                              ))}
                            </select>
                            <span className="field-hint">
                              Sono mostrati solo i gruppi attivi in cui sono presenti tutti gli
                              utenti coinvolti nel saldo rimanente (
                              {transferTargets.involvedUserIds.map(nameOf).join(', ')}).
                            </span>
                          </label>

                          {needsFx && selectedTargetGroup && (
                            <div
                              className="card"
                              style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: 12.5,
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>
                                  Conversione {group.baseCurrency} →{' '}
                                  {selectedTargetGroup.baseCurrency}
                                </span>
                                <button
                                  type="button"
                                  className="link-btn"
                                  style={{
                                    fontSize: 12,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                  onClick={() => setFxManual(false)}
                                  disabled={loadingFx}
                                >
                                  <RefreshCw size={11} />{' '}
                                  {loadingFx ? 'Aggiorno…' : 'Cambio automatico'}
                                </button>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13 }}>1 {group.baseCurrency} =</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="input input-sm tabular"
                                  style={{ width: 118 }}
                                  value={fxStr}
                                  onChange={(e) => {
                                    setFxManual(true);
                                    setFxStr(e.target.value);
                                  }}
                                />
                                <span style={{ fontSize: 13 }}>
                                  {selectedTargetGroup.baseCurrency}
                                </span>
                              </div>
                              {parsedFx > 0 && (
                                <span className="field-hint">
                                  Tasso applicato: {formatRateValue(parsedFx)} (salvato senza
                                  modifiche retroattive).
                                </span>
                              )}
                            </div>
                          )}

                          <p className="field-hint">
                            Il saldo di <strong>{group.name}</strong> verrà portato a zero e
                            sommato automaticamente ai saldi di{' '}
                            <strong>{selectedTargetGroup?.name}</strong>, senza alterare le
                            statistiche di spesa negli Insights.
                          </p>
                        </div>
                      ) : (
                        <p className="field-hint">
                          Il gruppo verrà archiviato come chiuso mantenendo invariato il saldo
                          residuo indicato sopra.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="alert alert-warning" style={{ flexDirection: 'column', gap: 6 }}>
                      <span>
                        Non hai ancora un altro gruppo attivo che includa tutti gli utenti coinvolti
                        nel saldo rimanente (
                        <strong>{transferTargets.involvedUserIds.map(nameOf).join(', ')}</strong>).
                      </span>
                      {transferTargets.ineligible.length > 0 && (
                        <span style={{ fontSize: 12.5 }}>
                          {transferTargets.ineligible.slice(0, 3).map((item) => (
                            <span key={item.overview.group.id} style={{ display: 'block' }}>
                              • In &ldquo;{item.overview.group.name}&rdquo; manca:{' '}
                              {item.missingNames.join(', ')} (se saldi prima la sua quota, potrai
                              spostare qui il resto).
                            </span>
                          ))}
                        </span>
                      )}
                      <span style={{ fontSize: 12.5 }}>
                        Puoi creare o aprire un gruppo con queste persone, pareggiare le quote di chi
                        non ne fa parte, oppure chiudere comunque questo gruppo senza spostare il
                        saldo.
                      </span>
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleConfirmCloseGroup}
                  disabled={closingBusy || loadingFx}
                >
                  <Archive size={14} />
                  {closingBusy
                    ? 'Chiusura in corso…'
                    : transfers.length > 0 &&
                        closeMode === 'transfer' &&
                        selectedTargetGroup
                      ? `Sposta saldo in "${selectedTargetGroup.name}" e chiudi`
                      : 'Conferma chiusura gruppo'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowClosePanel(false)}
                  disabled={closingBusy}
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Dettagli gruppo e categorie personalizzate (solo se il gruppo è aperto) */}
        {!isClosed && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />

            <form className="form-stack" onSubmit={handleSaveGroup}>
              <div style={{ fontSize: 14, fontWeight: 650 }}>Dettagli generali</div>
              <label className="field">
                <span className="field-label">Nome del gruppo</span>
                <input
                  type="text"
                  className="input"
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Descrizione</span>
                <input
                  type="text"
                  className="input"
                  maxLength={280}
                  placeholder="Opzionale"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span className="field-hint">
                  Valuta di riferimento contabile: <strong>{group.baseCurrency}</strong>
                </span>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={savingGroup || groupUnchanged || !name.trim()}
                >
                  {savingGroup ? 'Salvo…' : 'Salva dettagli'}
                </button>
              </div>
            </form>
          </>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />

        {/* Membri attivi */}
        <div className="field">
          <div style={{ fontSize: 14, fontWeight: 650 }}>
            Membri del gruppo ({activeMembers.length})
          </div>
          <div className="split-list">
            {activeMembers.map((m) => (
              <div key={m.userId} className="split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={m.displayName} seed={m.userId} size={30} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {m.displayName}
                      {m.userId === currentUserId && (
                        <span className="text-muted" style={{ fontWeight: 400 }}>
                          {' '}
                          (tu)
                        </span>
                      )}
                    </div>
                    <div className="field-hint">
                      Nel gruppo dal {formatFullDateIT(m.joinedAt.slice(0, 10))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {!isClosed && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />

            {/* Categorie personalizzate */}
            <div className="form-stack">
              <div>
                <div style={{ fontSize: 14, fontWeight: 650 }}>Categorie personalizzate</div>
                <div className="field-hint">
                  Si aggiungono alle 12 categorie predefinite per tutti i membri del gruppo.
                </div>
              </div>

              {customCategories.length > 0 && (
                <div className="split-list">
                  {customCategories.map((c) => (
                    <div key={c.id} className="split-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CategoryIcon icon={c.icon} color={c.color} boxed size={16} />
                        <span style={{ fontSize: 14, fontWeight: 550 }}>{c.name}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => handleDeleteCat(c)}
                        aria-label={`Elimina categoria ${c.name}`}
                        title="Rimuovi categoria"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form className="fx-box" onSubmit={handleCreateCat}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="input input-sm"
                    placeholder="Nuova categoria (es. Animali, Palestra…)"
                    maxLength={40}
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn btn-secondary btn-sm"
                    disabled={addingCat || !catName.trim()}
                  >
                    <Plus size={14} />
                    Aggiungi
                  </button>
                </div>
                <div className="swatch-row">
                  {CUSTOM_CATEGORY_ICONS.map((ic) => (
                    <button
                      key={ic.id}
                      type="button"
                      title={ic.label}
                      className={`icon-swatch ${catIcon === ic.id ? 'active' : ''}`}
                      onClick={() => setCatIcon(ic.id)}
                    >
                      <CategoryIcon
                        icon={ic.id}
                        color={catIcon === ic.id ? catColor : '#57534e'}
                        size={15}
                      />
                    </button>
                  ))}
                </div>
                <div className="swatch-row">
                  {CUSTOM_CATEGORY_COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      className={`color-swatch ${catColor === col ? 'active' : ''}`}
                      style={{ backgroundColor: col }}
                      onClick={() => setCatColor(col)}
                      aria-label={`Colore ${col}`}
                    />
                  ))}
                </div>
              </form>
            </div>
          </>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />

        {/* Uscita dal gruppo (sempre consentita, anche con saldo diverso da zero) */}
        <div className="field">
          <div style={{ fontSize: 14, fontWeight: 650 }}>Uscita dal gruppo</div>
          {confirmLeave ? (
            <div className="alert alert-error" style={{ flexDirection: 'column', gap: 10 }}>
              <span>
                {activeMembers.length === 1 ? (
                  <>
                    Sei l&apos;unico membro rimasto: uscendo, questo gruppo e tutte le sue spese
                    verranno eliminati definitivamente. Confermi?
                  </>
                ) : hasNonZeroMyBalance ? (
                  <>
                    Il tuo saldo attuale in questo gruppo è{' '}
                    <strong className="tabular">
                      {formatMoney(myBalance, group.baseCurrency, { signed: true })}
                    </strong>{' '}
                    (non è a zero). Puoi uscire comunque: il saldo rimarrà visibile agli altri
                    membri del gruppo e l&apos;uscita verrà annotata nello storico. Confermi?
                  </>
                ) : (
                  <>
                    Confermi di voler uscire dal gruppo &ldquo;{group.name}&rdquo;? Per rientrare
                    in futuro ti basterà accettare di nuovo un link d&apos;invito.
                  </>
                )}
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-danger-solid btn-sm"
                  onClick={handleLeave}
                  disabled={leaving}
                >
                  {leaving
                    ? 'Operazione in corso…'
                    : activeMembers.length === 1
                      ? 'Elimina gruppo ed esci'
                      : hasNonZeroMyBalance
                        ? 'Sì, esci anche con saldo aperto'
                        : 'Sì, esci dal gruppo'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setConfirmLeave(false)}
                  disabled={leaving}
                >
                  Annulla
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span className="field-hint">
                {activeMembers.length === 1 ? (
                  'Sei l’unico membro rimasto: uscendo il gruppo verrà eliminato.'
                ) : hasNonZeroMyBalance ? (
                  <>
                    Puoi uscire in qualsiasi momento, anche se il tuo saldo attuale è{' '}
                    <strong className="tabular">
                      {formatMoney(myBalance, group.baseCurrency, { signed: true })}
                    </strong>
                    .
                  </>
                ) : (
                  'Puoi uscire dal gruppo in qualsiasi momento.'
                )}
              </span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmLeave(true)}
              >
                <LogOut size={14} />
                {activeMembers.length === 1 ? 'Elimina gruppo' : 'Esci dal gruppo'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
