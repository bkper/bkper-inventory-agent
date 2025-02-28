import { Account, AccountType, Amount, Book, Group, Transaction } from "bkper-js";
import { EventHandlerTransaction } from "./EventHandlerTransaction.js";
import { buildBookAnchor, getCOGSCalculationDateValue, getQuantity } from "./BotService.js";
import { EXC_CODE_PROP, GOOD_BUY_ACCOUNT_NAME, GOOD_PROP, GOOD_PURCHASE_COST_PROP, GOOD_SELL_ACCOUNT_NAME, NEEDS_REBUILD_PROP, ORDER_PROP, ORIGINAL_QUANTITY_PROP, PURCHASE_CODE_PROP, PURCHASE_INVOICE_PROP, SALE_AMOUNT_PROP, SALE_INVOICE_PROP, TOTAL_COST_PROP } from "./constants.js";
import { Result } from "./index.js";
import { InterceptorFlagRebuild } from "./InterceptorFlagRebuild.js";

export class EventHandlerTransactionChecked extends EventHandlerTransaction {

    async intercept(eventBook: Book, event: bkper.Event): Promise<Result> {
        let response = await new InterceptorFlagRebuild().intercept(eventBook, event);
        return response;
    }

    // financial transaction had been already replicated in the inventory book
    protected async connectedTransactionFound(inventoryBook: Book, goodTransaction: Transaction): Promise<string | undefined> {
        const bookAnchor = buildBookAnchor(inventoryBook);
        const record = `${goodTransaction.getDate()} ${goodTransaction.getAmount()} ${await goodTransaction.getCreditAccountName()} ${await goodTransaction.getDebitAccountName()} ${goodTransaction.getDescription()}`;
        return `FOUND: ${bookAnchor} ${record}`;
    }

    // create purchase (Buy) or sale (Sell) transactions in the inventory book in response to the financial transactions
    protected async connectedTransactionNotFound(inventoryBook: Book, financialTransaction: bkper.Transaction, goodExcCode: string): Promise<string | undefined> {
        if (financialTransaction.debitAccount && financialTransaction.date && financialTransaction.id && financialTransaction.properties) {

            const quantity = getQuantity(financialTransaction);
            const purchaseInvoice = financialTransaction.properties[PURCHASE_INVOICE_PROP];
            const saleInvoice = financialTransaction.properties[SALE_INVOICE_PROP];

            // prevent bot response when transaction is missing quantity or is not a purchase or sale transaction
            if (quantity == undefined || quantity.eq(0)) {
                return undefined;
            }

            if (saleInvoice) {
                // Selling
                const goodProperty = financialTransaction.properties?.[GOOD_PROP];

                let inventoryAccount = await inventoryBook.getAccount(goodProperty);
                if (!inventoryAccount) {
                    inventoryAccount = await this.createConnectedInventoryAccount(inventoryBook, goodProperty);
                }
                
                console.log('SELL: inventoryAccount', inventoryAccount.getName(), inventoryAccount.getType());

                let inventorySellAccount = await inventoryBook.getAccount(GOOD_SELL_ACCOUNT_NAME);
                if (!inventorySellAccount) {
                    inventorySellAccount = await new Account(inventoryBook).setName(GOOD_SELL_ACCOUNT_NAME).setType(AccountType.OUTGOING).create();
                }

                const newTransaction = await new Transaction(inventoryBook)
                    .setDate(financialTransaction.date)
                    .setAmount(quantity)
                    .setCreditAccount(inventoryAccount)
                    .setDebitAccount(inventorySellAccount)
                    .setDescription(financialTransaction.description ?? '')
                    .addRemoteId(financialTransaction.id)
                    .setProperty(SALE_INVOICE_PROP, financialTransaction.properties[SALE_INVOICE_PROP])
                    .setProperty(ORDER_PROP, financialTransaction.properties[ORDER_PROP])
                    .setProperty(SALE_AMOUNT_PROP, new Amount(financialTransaction.amount ?? 0).toString())
                    .setProperty(EXC_CODE_PROP, goodExcCode)
                    .post()
                    ;

                const inventoryBookAnchor = buildBookAnchor(inventoryBook);
                const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${inventoryAccount.getName()} ${inventoryAccount.getName()} ${newTransaction.getDescription()}`;
                const needsRebuild = await this.checkLastTxDate(inventoryAccount, financialTransaction);

                if (needsRebuild) {
                    return `SELL: ${inventoryBookAnchor}: ${record} / WARNING: Transaction date is before the last COGS calculation date. Flagging account ${inventoryAccount.getName()} for rebuild`;
                } else {
                    return `SELL: ${inventoryBookAnchor}: ${record}`;
                }

            } else if (purchaseInvoice) {
                // Buying
                const financialDebitAccount = financialTransaction.debitAccount;
                let inventoryAccount = await inventoryBook.getAccount(financialDebitAccount.name);
                if (!inventoryAccount) {
                    inventoryAccount = await this.createConnectedInventoryAccount(inventoryBook, financialDebitAccount);
                }

                console.log('BUY: inventoryAccount', inventoryAccount.getName(), inventoryAccount.getType());

                let inventoryBuyAccount = await inventoryBook.getAccount(GOOD_BUY_ACCOUNT_NAME);
                if (inventoryBuyAccount == null) {
                    inventoryBuyAccount = await new Account(inventoryBook).setName(GOOD_BUY_ACCOUNT_NAME).setType(AccountType.INCOMING).create();
                }

                const newTransaction = await new Transaction(inventoryBook)
                    .setDate(financialTransaction.date)
                    .setAmount(quantity)
                    .setCreditAccount(inventoryBuyAccount)
                    .setDebitAccount(inventoryAccount)
                    .setDescription(financialTransaction.description ?? '')
                    .addRemoteId(financialTransaction.id)
                    .setProperty(PURCHASE_CODE_PROP, financialTransaction.properties[PURCHASE_CODE_PROP])
                    .setProperty(ORIGINAL_QUANTITY_PROP, quantity.toString())
                    .setProperty(GOOD_PURCHASE_COST_PROP, new Amount(financialTransaction.amount ?? 0).toString())
                    .setProperty(ORDER_PROP, financialTransaction.properties[ORDER_PROP])
                    .setProperty(EXC_CODE_PROP, goodExcCode)
                    .setProperty(TOTAL_COST_PROP, new Amount(financialTransaction.amount ?? 0).toString())
                    .post()
                    ;

                const inventoryBookAnchor = buildBookAnchor(inventoryBook);
                const record = `${newTransaction.getDate()} ${newTransaction.getAmount()} ${inventoryBuyAccount.getName()} ${inventoryAccount.getName()} ${newTransaction.getDescription()}`;
                const needsRebuild = await this.checkLastTxDate(inventoryAccount, financialTransaction);

                if (needsRebuild) {
                    return `BUY: ${inventoryBookAnchor}: ${record} / WARNING: Transaction date is before the last COGS calculation date. Flagging account ${inventoryAccount.getName()} for rebuild`;
                } else {
                    return `BUY: ${inventoryBookAnchor}: ${record}`;
                }
            }
        }

        return undefined;
    }

    private async checkLastTxDate(goodAccount: Account, transaction: bkper.Transaction): Promise<boolean> {
        let lastTxDate = getCOGSCalculationDateValue(goodAccount);
        if (lastTxDate != null && (transaction.dateValue != undefined && transaction.dateValue <= +lastTxDate)) {
            await goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
            return true;
        }
        return false;
    }

    // returns the good account from the inventory book corresponding to the good account in the financial book (creates the account if it doesn't exist)
    private async createConnectedInventoryAccount(inventoryBook: Book, financialAccount: bkper.Account | string): Promise<Account> {

        let inventoryAccountName: string;
        let inventoryAccountProperties: { [key: string]: string; } = {};
        let inventoryAccountArchived: boolean;
        let inventoryAccountGroups: bkper.Group[] = [];

        if (typeof (financialAccount) === 'string') {
            inventoryAccountName = financialAccount;
            inventoryAccountProperties = {};
            inventoryAccountArchived = false;
            inventoryAccountGroups = [];
        } else {
            inventoryAccountName = financialAccount.name!;
            inventoryAccountProperties = financialAccount.properties ?? {};
            inventoryAccountArchived = financialAccount.archived ?? false;
            inventoryAccountGroups = financialAccount.groups ?? [];
        }

        let inventoryAccount = new Account(inventoryBook)
            .setName(inventoryAccountName)
            .setType(AccountType.ASSET)
            .setProperties(inventoryAccountProperties)
            .setArchived(inventoryAccountArchived);

        if (inventoryAccountGroups.length > 0) {
            for (const group of inventoryAccountGroups) {
                let inventoryGroup = await inventoryBook.getGroup(group.name);
                if (!inventoryGroup) {
                    inventoryGroup = await new Group(inventoryBook)
                        .setName(group.name ?? '')
                        .setParent(await inventoryBook.getGroup(group.parent?.name))
                        .setProperties(group.properties ?? {})
                        .setHidden(group.hidden ?? false)
                        .create()
                        ;
                }
                if (inventoryGroup) {
                    inventoryAccount.addGroup(inventoryGroup);
                }
            }
        }
        inventoryAccount = await inventoryAccount.create();

        return inventoryAccount;
    }

}