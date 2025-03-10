import { Account, AccountType, Amount, Bkper, Book, Transaction } from 'bkper-js';

import { COGS_CALC_DATE_PROP, EXC_CODE_PROP, INVENTORY_BOOK_PROP, NEEDS_REBUILD_PROP, QUANTITY_PROP  } from './constants.js';

export function isInventoryBook(book: Book): boolean {
    if (book.getProperty(INVENTORY_BOOK_PROP)) {
        return true;
    }
    return false;
}

// returns the quantity property from a transaction or null if it does not exist
export function getQuantity(transaction: bkper.Transaction): Amount | undefined {
    let quantityStr = transaction.properties?.[QUANTITY_PROP];
    if (quantityStr == undefined || quantityStr.trim() == '') {
        return undefined;
    }
    return new Amount(quantityStr);
}

// returns the inventory book from a collection or null if it does not exist
export function getInventoryBook(book: Book): Book | undefined {
    if (book.getCollection() == undefined) {
        return undefined;
    }
    let connectedBooks = book.getCollection()!.getBooks();
    for (const connectedBook of connectedBooks) {
        if (connectedBook.getProperty(INVENTORY_BOOK_PROP)) {
            return connectedBook;
        }
    }
    return undefined;
}

// returns the financial book in the collection corresponding to the excCode or undefined if it does not exist
export async function getFinancialBook(book: Book, excCode?: string): Promise<Book | undefined> {
    if (book.getCollection() == undefined) {
        return undefined;
    }
    let connectedBooks = book.getCollection()!.getBooks();
    for (const connectedBook of connectedBooks) {
        let excCodeConnectedBook = getBookExcCode(connectedBook);
        if (excCode == excCodeConnectedBook) {
            return Bkper.getBook(connectedBook.getId());
        }
    }
    return undefined;
}

export function getBookExcCode(book: Book): string | undefined {
    return book.getProperty(EXC_CODE_PROP, 'exchange_code');
}

// returns the excCode from an account based on its groups good_exc_code property
export async function getExchangeCodeFromAccount(account: Account | bkper.Account): Promise<string | undefined> {

    if (account instanceof Account) {
        if (account.getType() == AccountType.INCOMING || account.getType() == AccountType.OUTGOING) {
            return undefined;
        }
        let groups = await account.getGroups();
        if (groups != null) {
            for (const group of groups) {
                let excCode = group.getProperty(EXC_CODE_PROP);
                if (excCode != undefined && excCode.trim() != '') {
                    return excCode;
                }
            }
        }
    } else {
        if (account.type == AccountType.INCOMING || account.type == AccountType.OUTGOING) {
            return undefined;
        }
        let groups = account.groups;
        if (groups != undefined) {
            for (const group of groups) {
                let goodExchange = group.properties?.[EXC_CODE_PROP];
                if (goodExchange != undefined && goodExchange.trim() != '') {
                    return goodExchange;
                }
            }
        }
    }

    return undefined;
}

// returns the good account (asset account) from the transaction (purchase or sale)
export async function getGoodAccount(goodTransaction: Transaction): Promise<Account | undefined> {
    if (await isSale(goodTransaction)) {
        return await goodTransaction.getCreditAccount();
    }
    if (await isPurchase(goodTransaction)) {
        return await goodTransaction.getDebitAccount();
    }
    return undefined;
}

export async function isSale(transaction: Transaction): Promise<boolean> {
    return (transaction.isPosted() == true) && (await transaction.getDebitAccount())?.getType() == AccountType.OUTGOING;
}

export async function isPurchase(transaction: Transaction): Promise<boolean> {
    return (transaction.isPosted() == true) && (await transaction.getCreditAccount())?.getType() == AccountType.INCOMING;
}

export function buildBookAnchor(book?: Book): string | undefined {
    return book ? `<a href='https://app.bkper.com/b/#transactions:bookId=${book.getId()}'>${book.getName()}</a>` : undefined;
}

export async function uncheckAndTrash(transaction: Transaction): Promise<Transaction> {
    if (transaction.isChecked()) {
        transaction = await transaction.uncheck();
    }
    transaction = await transaction.trash();
    return transaction;
}

export function getCOGSCalculationDateValue(account: Account): number | null {
    const cogsCalcDate = account.getProperty(COGS_CALC_DATE_PROP);
    if (cogsCalcDate) {
        return +(cogsCalcDate.replace(/-/g, ""));
    }
    return null
}

export async function flagInventoryAccountForRebuildIfNeeded(financialBook: Book, inventoryTransaction: Transaction): Promise<string | undefined> {
    let inventoryAccount = await getGoodAccount(inventoryTransaction);
    if (inventoryAccount) {
        let lastTxDate = getCOGSCalculationDateValue(inventoryAccount);
        if (lastTxDate != null && inventoryTransaction.getDateValue() != undefined && inventoryTransaction.getDateValue()! <= +lastTxDate) {
            await inventoryAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
            const inventoryBook = getInventoryBook(financialBook);
            return buildBookAnchor(inventoryBook) ? `${buildBookAnchor(inventoryBook)}: Flagging account for rebuild` : 'Flagging account for rebuild';
        }
    }
    return undefined;
}

export async function flagInventoryAccountForRebuild(financialBook: Book, inventoryTransaction: Transaction): Promise<string | undefined> {
    let inventoryAccount = await getGoodAccount(inventoryTransaction);
    if (inventoryAccount) {
        await inventoryAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
        const inventoryBook = getInventoryBook(financialBook);
        return buildBookAnchor(inventoryBook) ? `${buildBookAnchor(inventoryBook)}: Flagging account for rebuild` : 'Flagging account for rebuild';
    }
    return undefined;
}

/**
* Builds a query string for searching transactions by account name with optional date filters
* @param goodAccountName The name of the account to search for
* @param beforeDate Optional date to filter transactions before (format: YYYY-MM-DD)
* @param afterDate Optional date to filter transactions after (format: YYYY-MM-DD)
* @returns Query string in the format "account:'name' after:date before:date"
*/
export function getAccountQuery(goodAccountName: string, beforeDate?: string, afterDate?: string): string {
    let query = `account:'${goodAccountName}'`;

    if (afterDate) {
        query += ` after:${afterDate}`
    }

    if (beforeDate) {
        query += ` before:${beforeDate}`
    }
    return query;
}