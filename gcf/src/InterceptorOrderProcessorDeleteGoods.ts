import { Account, AccountType, Book, Transaction } from "bkper-js";
import { Result } from "./index.js";
import { InterceptorOrderProcessorDelete } from "./InterceptorOrderProcessorDelete.js";
import { buildBookAnchor, getExchangeCodeFromAccount, getFinancialBook, getGoodAccount } from "./BotService.js";
import { NEEDS_REBUILD_PROP, ORIGINAL_QUANTITY_PROP } from "./constants.js";

export class InterceptorOrderProcessorDeleteGoods extends InterceptorOrderProcessorDelete {

    async intercept(inventoryBook: Book, event: bkper.Event): Promise<Result> {

        const operation = event.data?.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction;

        if (transactionPayload && !transactionPayload.posted) {
            return { result: false };
        }

        const goodAccount = transactionPayload ? await this.getGoodAccount(inventoryBook, transactionPayload) : undefined;
        if (!goodAccount) {
            return { result: false };
        }

        let responses: Transaction[] | undefined;

        // delete splitted purchase transactions in inventory book and flag account for rebuild when deleting the original purchase transaction
        if (transactionPayload!.properties?.[ORIGINAL_QUANTITY_PROP]) {
            responses = await this.cascadeDeleteTransactions(inventoryBook, transactionPayload!);
            if (responses) {
                goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
                const warningMsg = `Flagging account ${goodAccount.getName()} for rebuild`;
                return { result: await this.buildResults(inventoryBook, responses), warning: warningMsg };
            }
        }
        
        const goodExcCode = await getExchangeCodeFromAccount(goodAccount);
        const financialBook = await getFinancialBook(inventoryBook, goodExcCode);

        // delete COGS transaction in financial book when deleting a sale transaction in inventory book
        responses = financialBook && transactionPayload ? await this.cascadeDeleteTransactions(financialBook, transactionPayload) : undefined;
        if (responses) {
            return { result: await this.buildResults(financialBook!, responses) };
        }

        return { result: false };
    }

    private async getGoodAccount(inventoryBook: Book, transactionPayload: bkper.Transaction): Promise<Account | undefined> {
        if (transactionPayload.debitAccount?.type == AccountType.OUTGOING) {
            return await inventoryBook.getAccount(transactionPayload.debitAccount.id);
        }
        if (transactionPayload.creditAccount?.type == AccountType.INCOMING) {
            return await inventoryBook.getAccount(transactionPayload.creditAccount.id);
        }
        return undefined;
    }

    private async buildResults(inventoryBook: Book, responses: Transaction[]): Promise<string[]> {
        const bookAnchor = buildBookAnchor(inventoryBook);
        let results: string[] = [];
        for (const response of responses) {
            results.push(`${bookAnchor}: ${await this.buildDeleteResponse(response)}`);
        }
        return results;
    }

}