import { Archive, ArchiveRestore, ArrowRight, LogOut, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { convertTransferAmount, getGroupTransferTargets } from '../lib/accounting';
import { formatMoney, formatRateValue } from '../lib/currencies';
import { formatFullDateIT, todayISO } from '../lib/dates';
import { quickTransferTargets } from '../lib/quickEvent';
import { translateErrorIT } from '../lib/supabase';
import { useExchangeRate } from '../lib/useExchangeRate';
import type {
  ExpenseGroup,
  GroupMember,
  GroupOverview,
  MemberBalance,
  QuickEventMatch,
  SimplifiedTransfer,
} from '../types';
import { Avatar } from './Icon';
import { CategoryManager, type CategoryManagerProps } from './CategoryManager';
import { Modal } from './Modal';
import { RateInput } from './RateInput';

interface GroupSettingsModalProps extends CategoryManagerProps {
  open: boolean;
  onClose: () => void;
  initialFocusClose?: boolean;
  group: ExpenseGroup;
  allGroups: GroupOverview[];
  quickMatches?: QuickEventMatch[];
  members: GroupMember[];
  balances: MemberBalance[];
  transfers: SimplifiedTransfer[];
  currentUserId: string;
  onUpdateGroup: (name: string, description: string) => Promise<void>;
  onAddParticipant: (name: string) => Promise<void>;
  onCloseGroup: (params: {
    targetGroup: ExpenseGroup | null;
    exchangeRate: number;
    rateDate: string;
    rateIsManual: boolean;
  }) => Promise<void>;
  onReopenGroup: () => Promise<void>;
  onLeaveGroup: () => Promise<void>;
}

export function GroupSettingsModal({
  open,
  onClose,
  initialFocusClose = false,
  group,
  allGroups,
  quickMatches,
  members,
  balances,
  transfers,
  categories,
  currentUserId,
  onUpdateGroup,
  onAddParticipant,
  onSaveCategory,
  onMoveCategory,
  onDeleteCategory,
  onCloseGroup,
  onReopenGroup,
  onLeaveGroup,
  onToast,
}: GroupSettingsModalProps) {
  const isClosed = group.closedAt !== null;
  const isEvent = !!group.quickCreatorSeat;
  const eventCloseOnly = isEvent && initialFocusClose && !isClosed;

  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [savingGroup, setSavingGroup] = useState(false);

  const [newMember, setNewMember] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  // Chiusura gruppo e trasferimento saldo rimanente
  const [showClosePanel, setShowClosePanel] = useState(false);
  const [requestedMode, setCloseMode] = useState<'transfer' | 'keep'>('keep');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);

  // Uscita dal gruppo (consentita anche con saldo diverso da zero)
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const nameMap = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName])), [members]);
  const nameOf = (uid: string) => nameMap.get(uid) ?? 'Membro';

  const transferTargets = useMemo(
    () =>
      group.quickCreatorSeat
        ? quickTransferTargets(
            group.quickCreatorSeat,
            currentUserId,
            transfers,
            quickMatches ?? [],
            allGroups
          )
        : getGroupTransferTargets({
            sourceGroupId: group.id,
            sourceMembers: members,
            transfers,
            allGroups,
            nameOf,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group.id, group.quickCreatorSeat, currentUserId, quickMatches, transfers, allGroups, nameMap]
  );

  const closeMode = transferTargets.eligible.length > 0 ? requestedMode : 'keep';

  const selectedTargetGroup: ExpenseGroup | null = useMemo(() => {
    if (transfers.length === 0 || closeMode !== 'transfer' || !targetGroupId) return null;
    return transferTargets.eligible.find((g) => g.group.id === targetGroupId)?.group ?? null;
  }, [transfers.length, closeMode, targetGroupId, transferTargets.eligible]);

  const needsFx =
    selectedTargetGroup !== null && selectedTargetGroup.baseCurrency !== group.baseCurrency;

  const fx = useExchangeRate(
    open && showClosePanel && needsFx,
    group.baseCurrency,
    selectedTargetGroup?.baseCurrency ?? group.baseCurrency,
    todayISO()
  );
  const {
    reset: resetRate,
    rate: parsedFx,
    rateDate: fxDate,
    manual: fxManual,
    loading: loadingFx,
  } = fx;

  useEffect(() => {
    if (open) {
      setName(group.name);
      setDescription(group.description);
      setConfirmLeave(false);
      setShowClosePanel(initialFocusClose);
      if (!isEvent && transfers.length > 0 && transferTargets.eligible.length > 0) {
        setCloseMode('transfer');
        setTargetGroupId(transferTargets.eligible[0].group.id);
      } else {
        setCloseMode('keep');
        setTargetGroupId(
          transferTargets.eligible.length === 1 ? transferTargets.eligible[0].group.id : ''
        );
      }
      resetRate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group.id, initialFocusClose, resetRate]);

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

    if (
      needsFx &&
      selectedTargetGroup &&
      transfers.some(
        (t) =>
          convertTransferAmount(
            t.amount,
            group.baseCurrency,
            parsedFx,
            selectedTargetGroup.baseCurrency
          ) <= 0
      )
    ) {
      onToast('Il cambio non produce un importo trasferibile nella valuta di destinazione.', true);
      return;
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

  const groupUnchanged = name.trim() === group.name && description.trim() === group.description;

  const closingPanel = (
    <div className="field">
      <div style={{ fontSize: 14, fontWeight: 650 }}>
        {isClosed
          ? 'Stato del gruppo'
          : isEvent
            ? 'Chiusura della serata e saldo di coppia'
            : 'Chiusura del gruppo e saldo rimanente'}
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
              ? isEvent
                ? 'Puoi archiviare la serata così com’è oppure, dopo i rimborsi degli amici, riportare il residuo nel gruppo di coppia.'
                : 'Chiudi il gruppo e sposta automaticamente il saldo rimanente in un altro gruppo condiviso.'
              : 'I conti sono in pari: puoi chiudere il gruppo mantenendone lo storico in sola lettura.'}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (!isEvent && transfers.length > 0 && transferTargets.eligible.length > 0) {
                setCloseMode('transfer');
                if (!targetGroupId) {
                  setTargetGroupId(transferTargets.eligible[0].group.id);
                }
              }
              setShowClosePanel(true);
            }}
          >
            <Archive size={14} />
            {isEvent ? 'Concludi serata…' : 'Chiudi gruppo…'}
          </button>
        </div>
      ) : (
        <div className="fx-box" style={{ gap: 12 }}>
          {transfers.length === 0 ? (
            <div style={{ fontSize: 13.5 }}>
              Tutti i saldi sono già pari a zero. Chiudendo <strong>{group.name}</strong> non
              verranno aggiunte nuove spese (ricorrenze e link d&apos;invito verranno disattivati),
              ma potrai sempre consultare spese, Insights e CSV o riaprirlo in seguito.
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
                              convertTransferAmount(
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
                  <div className="segmented close-mode">
                    <button
                      type="button"
                      className={`segmented-btn ${closeMode === 'transfer' ? 'active' : ''}`}
                      aria-pressed={closeMode === 'transfer'}
                      onClick={() => setCloseMode('transfer')}
                    >
                      {isEvent ? 'Riporta nel gruppo di coppia' : 'Sposta in un altro gruppo'}
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${closeMode === 'keep' ? 'active' : ''}`}
                      aria-pressed={closeMode === 'keep'}
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
                            resetRate();
                            setTargetGroupId(e.target.value);
                          }}
                        >
                          {isEvent && <option value="">Scegli il gruppo di coppia</option>}
                          {transferTargets.eligible.map((ov) => (
                            <option key={ov.group.id} value={ov.group.id}>
                              {ov.group.name} ({ov.group.baseCurrency} ·{' '}
                              {ov.members.map((m) => m.displayName).join(', ')})
                            </option>
                          ))}
                        </select>
                        <span className="field-hint">
                          {isEvent ? (
                            'Verrà riportato solo il debito indicato sopra: la cena e le quote degli amici restano nella serata.'
                          ) : (
                            <>
                              Sono mostrati solo i gruppi attivi in cui sono presenti tutti gli
                              utenti coinvolti nel saldo rimanente (
                              {transferTargets.involvedUserIds.map(nameOf).join(', ')}).
                            </>
                          )}
                        </span>
                      </label>

                      {needsFx && selectedTargetGroup && (
                        <div
                          className="card"
                          style={{
                            padding: '10px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
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
                              Conversione {group.baseCurrency} → {selectedTargetGroup.baseCurrency}
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
                              onClick={() => resetRate()}
                              disabled={loadingFx}
                            >
                              <RefreshCw size={11} />{' '}
                              {loadingFx ? 'Aggiorno…' : 'Cambio automatico'}
                            </button>
                          </div>
                          <RateInput
                            key={targetGroupId}
                            from={group.baseCurrency}
                            to={selectedTargetGroup.baseCurrency}
                            quote={fx.quote}
                            onChange={fx.write}
                          />
                          {parsedFx > 0 && (
                            <span className="field-hint">
                              Tasso applicato: 1 {group.baseCurrency} = {formatRateValue(parsedFx)}{' '}
                              {selectedTargetGroup.baseCurrency}.
                            </span>
                          )}
                        </div>
                      )}

                      {isEvent && selectedTargetGroup && (!needsFx || parsedFx > 0) && (
                        <div className="card-subtle" aria-live="polite">
                          <strong>Conferma il riporto in {selectedTargetGroup.name}</strong>
                          <p>
                            {transfers[0].fromName} deve a {transfers[0].toName}{' '}
                            <strong>
                              {formatMoney(
                                convertTransferAmount(
                                  transfers[0].amount,
                                  group.baseCurrency,
                                  parsedFx,
                                  selectedTargetGroup.baseCurrency
                                ),
                                selectedTargetGroup.baseCurrency
                              )}
                            </strong>
                            . Le spese restano in {group.name}.
                          </p>
                        </div>
                      )}
                      {!isEvent && selectedTargetGroup && (
                        <p className="field-hint">
                          Il saldo di <strong>{group.name}</strong> verrà portato a zero e sommato
                          automaticamente ai saldi di <strong>{selectedTargetGroup.name}</strong>,
                          senza alterare le statistiche di spesa negli Insights.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="field-hint">
                      Il gruppo verrà archiviato come chiuso mantenendo invariato il saldo residuo
                      indicato sopra.
                    </p>
                  )}
                </>
              ) : isEvent ? (
                <p className="alert alert-warning">
                  {currentUserId !== group.quickCreatorSeat
                    ? 'Solo chi ha creato la serata può riportare un saldo nel gruppo di coppia.'
                    : transfers.length > 1
                      ? 'Ci sono ancora più rimborsi da fare. In Saldi registra quelli degli amici prima di riportare il residuo della coppia.'
                      : 'Non c’è un gruppo di coppia idoneo per questo saldo. Serve un gruppo aperto con voi due, riconosciuti dal posto scelto o da un invito accettato. Un nome uguale non basta.'}
                </p>
              ) : (
                <div className="alert alert-warning" style={{ flexDirection: 'column', gap: 6 }}>
                  <span>
                    Non hai ancora un altro gruppo attivo che includa tutti gli utenti coinvolti nel
                    saldo rimanente (
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
                    Ogni persona deve aver scelto il proprio nome in entrambi i gruppi: due nomi
                    uguali non bastano. Puoi pareggiare le quote di chi non ne fa parte, oppure
                    chiudere comunque questo gruppo senza spostare il saldo.
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
              disabled={
                closingBusy ||
                loadingFx ||
                (closeMode === 'transfer' && transfers.length > 0 && !selectedTargetGroup)
              }
            >
              <Archive size={14} />
              {closingBusy
                ? 'Chiusura in corso…'
                : transfers.length > 0 && closeMode === 'transfer' && selectedTargetGroup
                  ? `Sposta saldo in "${selectedTargetGroup.name}" e chiudi`
                  : isEvent
                    ? 'Archivia senza riporto'
                    : 'Conferma chiusura gruppo'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => (eventCloseOnly ? onClose() : setShowClosePanel(false))}
              disabled={closingBusy}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (eventCloseOnly) {
    return (
      <Modal open={open} title="Concludi serata" onClose={onClose} wide>
        {closingPanel}
      </Modal>
    );
  }

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
        {closingPanel}
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
                      {m.ownerId === null && (isEvent ? 'Partecipante senza accesso · ' : 'Nome da scegliere nell’invito · ')}Nel gruppo dal {formatFullDateIT(m.joinedAt.slice(0, 10))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!isClosed && !isEvent && (
            <form className="form-stack" onSubmit={async (event) => {
              event.preventDefault();
              setAddingMember(true);
              try {
                await onAddParticipant(newMember.trim());
                setNewMember('');
                onToast('Partecipante aggiunto');
              } catch (err) { onToast(translateErrorIT(err), true); }
              finally { setAddingMember(false); }
            }}>
              <label className="field">
                <span className="field-label">Aggiungi un partecipante</span>
                <input className="input" placeholder="Nome o soprannome" maxLength={60} required
                  value={newMember} onChange={(e) => setNewMember(e.target.value)} />
                <span className="field-hint">Puoi già dividere le spese con questa persona. Sceglierà il suo nome quando aprirà l’invito.</span>
              </label>
              <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={!newMember.trim() || addingMember}>
                <Plus size={14} /> Aggiungi nome
              </button>
            </form>
          )}
        </div>

        {!isClosed && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />

            <CategoryManager
              categories={categories}
              onSaveCategory={onSaveCategory}
              onMoveCategory={onMoveCategory}
              onDeleteCategory={onDeleteCategory}
              onToast={onToast}
            />
          </>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />

        {/* Uscita dal gruppo (sempre consentita, anche con saldo diverso da zero) */}
        <div className="field">
          <div style={{ fontSize: 14, fontWeight: 650 }}>Uscita dal gruppo</div>
          {confirmLeave ? (
            <div className="alert alert-error" style={{ flexDirection: 'column', gap: 10 }}>
              {activeMembers.length > 1 && activeMembers.every((m) => m.userId === currentUserId || !m.ownerId) && (
                <span>Sei l’unica persona che ha aperto questo gruppo. {group.inviteEnabled && !isClosed
                  ? 'Condividi il link prima di uscire: servirà per ritrovarlo.'
                  : 'Senza un invito attivo nessuno potrà rientrare dopo la tua uscita.'}</span>
              )}
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
