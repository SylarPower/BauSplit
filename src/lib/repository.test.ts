import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeExpenseSplits,
  computeGroupInsights,
  computeMemberBalances,
  convertToBaseAmount,
  getGroupTransferTargets,
  simplifyDebts,
} from './accounting';
import { DemoRepository, resetDemoDatabase } from '../../tests/fixtures/demoStore';
import { addDaysISO, todayISO } from './dates';
import { processDueRecurringExpenses } from './repository';

describe('Flusso end-to-end repository (gruppi, inviti, spese, cambi, rimborsi, ricorrenze, storico, uscita)', () => {
  let activeUser = 'demo-marco';
  let repo: DemoRepository;

  beforeEach(() => {
    resetDemoDatabase();
    activeUser = 'demo-marco';
    repo = new DemoRepository(() => activeUser);
  });

  it('gestisce ciclo completo: invito con accettazione, rigenerazione/disattivazione, spese, modifiche, rimborso e uscita a saldo zero', async () => {
    // 1. Marco crea un nuovo gruppo in EUR
    const group = await repo.createGroup({
      name: 'Vacanza Lisbona',
      description: 'Volo, hotel e cene',
      baseCurrency: 'EUR',
    });
    expect(group.baseCurrency).toBe('EUR');
    expect(group.inviteEnabled).toBe(true);
    const firstToken = group.inviteToken;

    // 2. Giulia apre il link: vede l'anteprima ma NON è ancora membro finché non accetta
    activeUser = 'demo-giulia';
    const preview = await repo.getInvitePreview(firstToken);
    expect(preview.valid).toBe(true);
    expect(preview.groupName).toBe('Vacanza Lisbona');
    expect(preview.createdByName).toBe('Marco');
    expect(preview.alreadyMember).toBe(false);

    const giuliaGroupsBefore = await repo.listGroupOverviews('demo-giulia');
    expect(giuliaGroupsBefore.some((g) => g.group.id === group.id)).toBe(false);

    // Giulia accetta l'invito
    const joinedId = await repo.acceptInvite(firstToken);
    expect(joinedId).toBe(group.id);

    // 3. Giulia rigenera il link: il precedente non è più valido
    const newToken = await repo.regenerateInvite(group.id);
    expect(newToken).not.toBe(firstToken);
    activeUser = 'demo-luca';
    expect((await repo.getInvitePreview(firstToken)).valid).toBe(false);
    expect((await repo.getInvitePreview(newToken)).valid).toBe(true);

    // Disattivazione del link blocca l'accesso
    activeUser = 'demo-marco';
    await repo.setInviteEnabled(group.id, false);
    activeUser = 'demo-luca';
    const disabledPreview = await repo.getInvitePreview(newToken);
    expect(disabledPreview).toEqual({ valid: false, reason: 'disabled' });
    await expect(repo.acceptInvite(newToken)).rejects.toThrow(/disattivato/i);

    // 4. Marco aggiunge una spesa in USD con cambio congelato (1 USD = 0.92 EUR)
    activeUser = 'demo-marco';
    const nameOf = (id: string) => (id === 'demo-marco' ? 'Marco' : 'Giulia');
    const usdBase = convertToBaseAmount(100, 'USD', 0.92, 'EUR'); // 92.00 EUR
    const split1 = computeExpenseSplits({
      totalAmount: 100,
      currency: 'USD',
      totalBaseAmount: usdBase,
      baseCurrency: 'EUR',
      splitMode: 'equal',
      participantIds: ['demo-marco', 'demo-giulia'],
    });

    const expId = await repo.saveExpense({
      input: {
        groupId: group.id,
        description: 'Tour in barca',
        amount: 100,
        currency: 'USD',
        exchangeRate: 0.92,
        rateDate: '2026-11-10',
        rateIsManual: false,
        baseAmount: usdBase,
        expenseDate: '2026-11-10',
        category: 'viaggi',
        categoryLabel: 'Viaggi e alloggi',
        paidBy: 'demo-marco',
        splitMode: 'equal',
        splits: split1.splits,
        note: '',
      },
      baseCurrency: 'EUR',
      nameOf,
    });

    // 5. Giulia modifica la nota della spesa: il tasso di cambio salvato resta 0.92 e lo storico traccia Giulia
    activeUser = 'demo-giulia';
    let data = await repo.getGroupData(group.id);
    const savedExp = data.expenses.find((e) => e.id === expId)!;
    await repo.saveExpense({
      input: {
        ...savedExp,
        note: 'Tramonto sul Tago',
      },
      baseCurrency: 'EUR',
      before: savedExp,
      nameOf,
    });

    data = await repo.getGroupData(group.id);
    const editedExp = data.expenses.find((e) => e.id === expId)!;
    expect(editedExp.exchangeRate).toBe(0.92);
    expect(editedExp.baseAmount).toBe(92);
    expect(editedExp.updatedBy).toBe('demo-giulia');
    expect(data.activityLogs[0]).toMatchObject({
      actorId: 'demo-giulia',
      actorName: 'Giulia',
      action: 'updated',
      entityType: 'expense',
    });
    expect(data.activityLogs[0].changes.diffs).toEqual([
      { field: 'Nota', before: '(vuota)', after: 'Tramonto sul Tago' },
    ]);

    // 6. Verifica piano rimborsi semplificato: Giulia deve 46,00 € a Marco
    const balances = computeMemberBalances(data.members, data.expenses, data.settlements, 'EUR');
    const transfers = simplifyDebts(balances, 'EUR');
    expect(transfers).toEqual([
      {
        fromUser: 'demo-giulia',
        fromName: 'Giulia',
        toUser: 'demo-marco',
        toName: 'Marco',
        amount: 46,
      },
    ]);

    // Registra rimborso: aggiorna subito i saldi senza conferma, escluso dagli Insights
    await repo.saveSettlement({
      input: {
        groupId: group.id,
        fromUser: 'demo-giulia',
        toUser: 'demo-marco',
        amount: 46,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: '2026-11-12',
        rateIsManual: false,
        baseAmount: 46,
        settlementDate: '2026-11-12',
        note: 'Satispay',
      },
      actorId: 'demo-giulia',
      baseCurrency: 'EUR',
      nameOf,
    });

    data = await repo.getGroupData(group.id);
    const balancesAfter = computeMemberBalances(
      data.members,
      data.expenses,
      data.settlements,
      'EUR'
    );
    expect(simplifyDebts(balancesAfter, 'EUR')).toHaveLength(0);

    const insights = computeGroupInsights(
      data.expenses,
      data.settlements,
      data.members,
      data.customCategories,
      'EUR'
    );
    expect(insights.totalSpent).toBe(92);
    expect(insights.expenseCount).toBe(1);
    expect(insights.excludedSettlementsCount).toBe(1);

    // 7. Giulia esce dal gruppo
    const leaveRes = await repo.leaveGroup(group.id);
    expect(leaveRes.groupDeleted).toBe(false);

    // Le spese storiche e lo storico rimangono integri per Marco
    activeUser = 'demo-marco';
    data = await repo.getGroupData(group.id);
    expect(data.members.filter((m) => m.leftAt === null)).toHaveLength(1);
    expect(data.activityLogs[0].action).toBe('left');
  });

  it('consente di uscire dal gruppo anche con saldo diverso da zero preservando il saldo aperto', async () => {
    // Nel gruppo demo "Fuga alle Cinque Terre", Marco deve 34,50 € a Giulia
    activeUser = 'demo-marco';
    const before = await repo.getGroupData('demo-group-cinqueterre');
    const balBefore = computeMemberBalances(
      before.members,
      before.expenses,
      before.settlements,
      'EUR'
    );
    expect(balBefore.find((b) => b.userId === 'demo-marco')?.netBalance).toBe(-34.5);

    // Marco esce nonostante il debito di -34,50 €
    const res = await repo.leaveGroup('demo-group-cinqueterre');
    expect(res.groupDeleted).toBe(false);

    // Giulia continua a vedere il gruppo, il saldo aperto di Marco e la voce nello storico
    activeUser = 'demo-giulia';
    const after = await repo.getGroupData('demo-group-cinqueterre');
    expect(after.members.filter((m) => m.leftAt === null).map((m) => m.userId)).toEqual([
      'demo-giulia',
    ]);
    expect(after.activityLogs[0].action).toBe('left');
    expect(after.activityLogs[0].summary).toContain('34,50');

    const balAfter = computeMemberBalances(
      after.members,
      after.expenses,
      after.settlements,
      'EUR'
    );
    const marcoBal = balAfter.find((b) => b.userId === 'demo-marco')!;
    expect(marcoBal.isActive).toBe(false);
    expect(marcoBal.netBalance).toBe(-34.5);
    expect(simplifyDebts(balAfter, 'EUR')).toEqual([
      {
        fromUser: 'demo-marco',
        fromName: 'Marco',
        toUser: 'demo-giulia',
        toName: 'Giulia',
        amount: 34.5,
      },
    ]);

    // Giulia può anche chiudere il gruppo e spostare quel saldo in "Casa e vita insieme"
    // perché sia Marco sia Giulia sono membri attivi di "Casa e vita insieme"!
    const casaBefore = await repo.getGroupData('demo-group-casa');
    const casaMarcoBefore = computeMemberBalances(
      casaBefore.members,
      casaBefore.expenses,
      casaBefore.settlements,
      'EUR'
    ).find((b) => b.userId === 'demo-marco')!.netBalance;

    await repo.closeGroup({
      sourceGroup: after.group,
      targetGroup: casaBefore.group,
      transfers: simplifyDebts(balAfter, 'EUR'),
      exchangeRate: 1,
      rateDate: todayISO(),
      rateIsManual: false,
      actorId: 'demo-giulia',
      nameOf: (id) => (id === 'demo-marco' ? 'Marco' : 'Giulia'),
    });

    const casaAfter = await repo.getGroupData('demo-group-casa');
    const casaMarcoAfter = computeMemberBalances(
      casaAfter.members,
      casaAfter.expenses,
      casaAfter.settlements,
      'EUR'
    ).find((b) => b.userId === 'demo-marco')!.netBalance;
    expect(Number((casaMarcoAfter - casaMarcoBefore).toFixed(2))).toBe(-34.5);
  });

  it('chiude un gruppo spostando il saldo solo verso gruppi con tutti gli utenti coinvolti (anche multi-valuta)', async () => {
    const nameOf = (id: string) =>
      id === 'demo-marco' ? 'Marco' : id === 'demo-giulia' ? 'Giulia' : 'Luca';

    // 1. Nel gruppo "Weekend a Londra" (3 membri: Marco, Giulia, Luca) tutti e 3 hanno saldo != 0:
    //    "Casa e vita insieme" (solo Marco e Giulia) NON è idoneo perché manca Luca!
    const allGroups = await repo.listGroupOverviews('demo-marco');
    const londra = await repo.getGroupData('demo-group-londra');
    const londraTransfers = simplifyDebts(
      computeMemberBalances(londra.members, londra.expenses, londra.settlements, 'EUR'),
      'EUR'
    );
    const check3 = getGroupTransferTargets({
      sourceGroupId: londra.group.id,
      sourceMembers: londra.members,
      transfers: londraTransfers,
      allGroups,
      nameOf,
    });
    expect(check3.eligible.some((g) => g.group.id === 'demo-group-casa')).toBe(false);
    expect(
      check3.ineligible.find((i) => i.overview.group.id === 'demo-group-casa')?.missingNames
    ).toEqual(['Luca']);

    // Anche il repository blocca il trasferimento se manca un utente coinvolto
    const casa = await repo.getGroupData('demo-group-casa');
    await expect(
      repo.closeGroup({
        sourceGroup: londra.group,
        targetGroup: casa.group,
        transfers: londraTransfers,
        exchangeRate: 1,
        rateDate: todayISO(),
        rateIsManual: false,
        actorId: 'demo-marco',
        nameOf,
      })
    ).rejects.toThrow(/devono far parte/i);

    // 2. Se invece Luca pareggia la propria quota nel gruppo a 3, il saldo residuo riguarda
    //    SOLO Marco e Giulia -> ora "Casa e vita insieme" diventa idoneo!
    const lucaNet = computeMemberBalances(
      londra.members,
      londra.expenses,
      londra.settlements,
      'EUR'
    ).find((b) => b.userId === 'demo-luca')!.netBalance;
    expect(lucaNet).toBeLessThan(0);

    await repo.saveSettlement({
      input: {
        groupId: londra.group.id,
        fromUser: 'demo-luca',
        toUser: 'demo-giulia',
        amount: Math.abs(lucaNet),
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: todayISO(),
        rateIsManual: false,
        baseAmount: Math.abs(lucaNet),
        settlementDate: todayISO(),
        note: 'Quota Luca saldata',
      },
      actorId: 'demo-luca',
      baseCurrency: 'EUR',
      nameOf,
    });

    const londraAfterLuca = await repo.getGroupData('demo-group-londra');
    const remainingTransfers = simplifyDebts(
      computeMemberBalances(
        londraAfterLuca.members,
        londraAfterLuca.expenses,
        londraAfterLuca.settlements,
        'EUR'
      ),
      'EUR'
    );
    expect(remainingTransfers).toHaveLength(1);
    const checkAfter = getGroupTransferTargets({
      sourceGroupId: londra.group.id,
      sourceMembers: londra.members,
      transfers: remainingTransfers,
      allGroups,
      nameOf,
    });
    expect(checkAfter.eligible.some((g) => g.group.id === 'demo-group-casa')).toBe(true);

    // 3. Test multi-valuta: gruppo in GBP (Marco paga 100 GBP diviso 2 -> Giulia deve 50 GBP)
    //    chiuso e trasferito in "Casa e vita insieme" (EUR) con tasso 1 GBP = 1.20 EUR (+60,00 € per Marco)
    const gbpGroup = await repo.createGroup({
      name: 'Edimburgo',
      description: '',
      baseCurrency: 'GBP',
    });
    activeUser = 'demo-giulia';
    await repo.acceptInvite(gbpGroup.inviteToken);
    activeUser = 'demo-marco';

    await repo.saveExpense({
      input: {
        groupId: gbpGroup.id,
        description: 'Hotel Edimburgo',
        amount: 100,
        currency: 'GBP',
        exchangeRate: 1,
        rateDate: '2026-11-15',
        rateIsManual: false,
        baseAmount: 100,
        expenseDate: '2026-11-15',
        category: 'viaggi',
        categoryLabel: 'Viaggi e alloggi',
        paidBy: 'demo-marco',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 50, baseAmount: 50, percentage: null },
          { userId: 'demo-giulia', amount: 50, baseAmount: 50, percentage: null },
        ],
        note: '',
      },
      baseCurrency: 'GBP',
      nameOf,
    });

    const casaInsightsBefore = computeGroupInsights(
      casa.expenses,
      casa.settlements,
      casa.members,
      casa.customCategories,
      'EUR'
    );
    const casaBalBefore = computeMemberBalances(
      casa.members,
      casa.expenses,
      casa.settlements,
      'EUR'
    );
    const marcoBefore = casaBalBefore.find((b) => b.userId === 'demo-marco')!.netBalance;
    const giuliaBefore = casaBalBefore.find((b) => b.userId === 'demo-giulia')!.netBalance;

    const gbpData = await repo.getGroupData(gbpGroup.id);
    const gbpTransfers = simplifyDebts(
      computeMemberBalances(gbpData.members, gbpData.expenses, gbpData.settlements, 'GBP'),
      'GBP'
    );
    expect(gbpTransfers).toEqual([
      {
        fromUser: 'demo-giulia',
        fromName: 'Giulia',
        toUser: 'demo-marco',
        toName: 'Marco',
        amount: 50,
      },
    ]);

    const closeRes = await repo.closeGroup({
      sourceGroup: gbpData.group,
      targetGroup: casa.group,
      transfers: gbpTransfers,
      exchangeRate: 1.2,
      rateDate: '2026-11-18',
      rateIsManual: true,
      actorId: 'demo-marco',
      nameOf,
    });
    expect(closeRes.transferredCount).toBe(1);

    // Il gruppo Edimburgo è chiuso, in pari (0,00 GBP), link invito bloccato e log registrato
    const gbpClosed = await repo.getGroupData(gbpGroup.id);
    expect(gbpClosed.group.closedAt).not.toBeNull();
    expect(gbpClosed.group.closedIntoGroupId).toBe(casa.group.id);
    expect(gbpClosed.group.closedIntoGroupName).toBe('Casa e vita insieme');
    expect(
      computeMemberBalances(
        gbpClosed.members,
        gbpClosed.expenses,
        gbpClosed.settlements,
        'GBP'
      ).every((b) => b.netBalance === 0)
    ).toBe(true);
    expect(await repo.getInvitePreview(gbpGroup.inviteToken)).toEqual({
      valid: false,
      reason: 'closed',
    });
    expect(gbpClosed.activityLogs[0].action).toBe('closed');

    // In "Casa e vita insieme": Marco +60 €, Giulia -60 €, Insights di spesa INVARIATI, log presente
    const casaUpdated = await repo.getGroupData(casa.group.id);
    const casaBalAfter = computeMemberBalances(
      casaUpdated.members,
      casaUpdated.expenses,
      casaUpdated.settlements,
      'EUR'
    );
    const marcoAfter = casaBalAfter.find((b) => b.userId === 'demo-marco')!;
    const giuliaAfter = casaBalAfter.find((b) => b.userId === 'demo-giulia')!;
    expect(Number((marcoAfter.netBalance - marcoBefore).toFixed(2))).toBe(60);
    expect(Number((giuliaAfter.netBalance - giuliaBefore).toFixed(2))).toBe(-60);
    expect(marcoAfter.transfersNet).toBe(60);
    expect(giuliaAfter.transfersNet).toBe(-60);

    const casaInsightsAfter = computeGroupInsights(
      casaUpdated.expenses,
      casaUpdated.settlements,
      casaUpdated.members,
      casaUpdated.customCategories,
      'EUR'
    );
    expect(casaInsightsAfter.totalSpent).toBe(casaInsightsBefore.totalSpent);
    expect(casaInsightsAfter.expenseCount).toBe(casaInsightsBefore.expenseCount);
    expect(casaUpdated.activityLogs[0].action).toBe('transferred_in');

    // Riapertura del gruppo senza duplicare saldi
    await repo.reopenGroup(gbpGroup.id, 'demo-marco');
    const gbpReopened = await repo.getGroupData(gbpGroup.id);
    expect(gbpReopened.group.closedAt).toBeNull();
    expect(gbpReopened.activityLogs[0].action).toBe('reopened');
  });

  it('genera le spese ricorrenti scadute senza duplicarle a un secondo controllo', async () => {
    const yesterday = addDaysISO(todayISO(), -1);
    const nameOf = (id: string) => (id === 'demo-marco' ? 'Marco' : 'Giulia');

    await repo.saveRecurring({
      input: {
        groupId: 'demo-group-casa',
        description: 'Spotify Duo',
        amount: 14.99,
        currency: 'EUR',
        fixedExchangeRate: null,
        category: 'abbonamenti',
        categoryLabel: 'Abbonamenti',
        paidBy: 'demo-marco',
        splitMode: 'equal',
        splits: [{ userId: 'demo-marco' }, { userId: 'demo-giulia' }],
        note: '',
        frequency: 'monthly',
        startDate: yesterday,
        nextDueDate: yesterday,
        endDate: null,
        active: true,
      },
      actorId: 'demo-marco',
      baseCurrency: 'EUR',
      nameOf,
    });

    const data1 = await repo.getGroupData('demo-group-casa');
    const gen1 = await processDueRecurringExpenses({
      repo,
      actorId: 'demo-marco',
      data: data1,
    });
    expect(gen1).toBe(1);

    const data2 = await repo.getGroupData('demo-group-casa');
    const gen2 = await processDueRecurringExpenses({
      repo,
      actorId: 'demo-giulia',
      data: data2,
    });
    expect(gen2).toBe(0);

    const spotifyExpenses = data2.expenses.filter((e) => e.description === 'Spotify Duo');
    expect(spotifyExpenses).toHaveLength(1);
    expect(spotifyExpenses[0].splits.map((s) => s.amount)).toEqual([7.5, 7.49]);
  });
});
