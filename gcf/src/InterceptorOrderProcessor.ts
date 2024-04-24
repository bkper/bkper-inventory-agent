import { Account, AccountType, Amount, Book } from "bkper";
import { Result } from ".";
import { getQuantity, isInventoryBook } from "./BotService";
import { ADDITIONAL_COST_PROP, GOOD_PROP, PURCHASE_CODE_PROP, PURCHASE_INVOICE_PROP, PURCHASE_PRICE_PROP, QUANTITY_PROP } from "./constants";

export class InterceptorOrderProcessor {

    async intercept(baseBook: Book, event: bkper.Event): Promise<Result> {

        // prevent response to Exchange Bot transactions
        if (event.agent.id == 'exchange-bot') {
            return { result: false };
        }

        // prevent response to transactions posted in the inventory book
        if (isInventoryBook(baseBook)) {
            return { result: false };
        }

        let operation = event.data.object as bkper.TransactionOperation;
        let transactionPayload = operation.transaction;

        if (!transactionPayload.posted) {
            return { result: false };
        }

        if (this.isGoodPurchase(transactionPayload)) {
            // prevent response to transactions posted without quantity or quantity = 0
            const quantity = getQuantity(baseBook, transactionPayload);
            if (quantity == null) {
                return { result: false };
            }
            if (quantity.eq(0)) {
                throw `Quantity must not be zero`;
            }
            return this.processGoodPurchase(baseBook, transactionPayload);
        }

        if (this.isAdditionalCost(transactionPayload)) {
            return this.processAdditionalCost(baseBook, transactionPayload);
        }

        return { result: false };

    }

    private isGoodPurchase(transactionPayload: bkper.Transaction): boolean {
        if (transactionPayload.creditAccount.type != AccountType.LIABILITY) {
            return false;
        }
        if (transactionPayload.properties[GOOD_PROP] == null) {
            return false;
        }
        if (transactionPayload.properties[PURCHASE_INVOICE_PROP] == null) {
            return false;
        }
        if (transactionPayload.properties[PURCHASE_CODE_PROP] != transactionPayload.properties[PURCHASE_INVOICE_PROP]) {
            return false;
        }
        return true;
    }

    private isAdditionalCost(transactionPayload: bkper.Transaction): boolean {
        if (transactionPayload.creditAccount.type != AccountType.LIABILITY) {
            return false;
        }
        if (transactionPayload.properties[GOOD_PROP] == null) {
            return false;
        }
        if (transactionPayload.properties[PURCHASE_CODE_PROP] == null) {
            return false;
        }
        return true;
    }

    // post aditional financial transaction from Buyer to Good (asset) in response to good purchase transaction from Supplier to Buyer
    private async processGoodPurchase(baseBook: Book, transactionPayload: bkper.Transaction): Promise<Result> {
        let buyerAccount = transactionPayload.debitAccount;
        let responses: string[] = await Promise.all(
            [
                // this.postFees(baseBook, exchangeAccount, transactionPayload),
                // this.postInterestOnPurchase(baseBook, exchangeAccount, transactionPayload),
                this.postGoodTradeOnPurchase(baseBook, buyerAccount, transactionPayload)
            ]);
        responses = responses.filter(r => r != null).filter(r => typeof r === "string");

        return { result: responses };
    }

    // post aditional financial transaction from Buyer to Good (asset) in response to service purchase transaction from Supplier to Buyer
    private async processAdditionalCost(baseBook: Book, transactionPayload: bkper.Transaction): Promise<Result> {
        let buyerAccount = transactionPayload.debitAccount;
        let responses: string[] = await Promise.all(
            [
                // this.postFees(baseBook, exchangeAccount, transactionPayload),
                // this.postInterestOnPurchase(baseBook, exchangeAccount, transactionPayload),
                this.postAdditionalCostOnPurchase(baseBook, buyerAccount, transactionPayload)
            ]);
        responses = responses.filter(r => r != null).filter(r => typeof r === "string");

        return { result: responses };
    }

    private async postGoodTradeOnPurchase(baseBook: Book, buyerAccount: bkper.Account, transactionPayload: bkper.Transaction): Promise<string> {
        let goodAccount = await this.getGoodAccount(baseBook, transactionPayload);
        let quantity = getQuantity(baseBook, transactionPayload);
        const amount = new Amount(transactionPayload.amount);
        const price = amount.div(quantity);
        let tx = await baseBook.newTransaction()
            .setAmount(amount)
            .from(buyerAccount)
            .to(goodAccount)
            .setDescription(transactionPayload.description + " - " + "GOOD_PURCHASE")
            .setDate(transactionPayload.date)
            .setProperty(QUANTITY_PROP, quantity.toString())
            .setProperty(PURCHASE_PRICE_PROP, price.toString())
            .setProperty(PURCHASE_INVOICE_PROP, transactionPayload.properties[PURCHASE_INVOICE_PROP])
            .setProperty(PURCHASE_CODE_PROP, transactionPayload.properties[PURCHASE_CODE_PROP])
            .addRemoteId(`${GOOD_PROP}_${transactionPayload.id}`)
            .post();

        console.log("postGoodTradeOnPurchase REMOTE_ID: ", tx.getRemoteIds());
        return `${tx.getDate()} ${tx.getAmount()} ${await tx.getCreditAccountName()} ${await tx.getDebitAccountName()} ${tx.getDescription()}`;
    }

    private async postAdditionalCostOnPurchase(baseBook: Book, buyerAccount: bkper.Account, transactionPayload: bkper.Transaction): Promise<string> {
        let goodAccount = await this.getGoodAccount(baseBook, transactionPayload);
        const amount = new Amount(transactionPayload.amount);
        let tx = await baseBook.newTransaction()
            .setAmount(amount)
            .from(buyerAccount)
            .to(goodAccount)
            .setDescription(transactionPayload.description + " - " + "ADDITIONAL_COST")
            .setDate(transactionPayload.date)
            .setProperty(ADDITIONAL_COST_PROP, amount.toString())
            .setProperty(PURCHASE_INVOICE_PROP, transactionPayload.properties[PURCHASE_INVOICE_PROP])
            .setProperty(PURCHASE_CODE_PROP, transactionPayload.properties[PURCHASE_CODE_PROP])
            .addRemoteId(`${GOOD_PROP}_${transactionPayload.id}`)
            .post();
        
        console.log("postAdditionalCostOnPurchase REMOTE_ID: ", tx.getRemoteIds());
        return `${tx.getDate()} ${tx.getAmount()} ${await tx.getCreditAccountName()} ${await tx.getDebitAccountName()} ${tx.getDescription()}`;
    }

    private async getGoodAccount(baseBook: Book, transactionPayload: bkper.Transaction): Promise<Account> {
        let good = transactionPayload.properties[GOOD_PROP];
        let goodAccount = await baseBook.getAccount(good);
        if (goodAccount == null) {
            goodAccount = await baseBook.newAccount().setName(good).setType(AccountType.ASSET).create();
        }
        return goodAccount;
    }

}