import 'mocha';
import { expect } from 'chai';

import { AccountType } from 'bkper-js';

import { EventHandlerTransactionChecked } from '../dist/EventHandlerTransactionChecked.js';

describe('EventHandlerTransactionChecked', () => {

    describe('#getTransactionQuery(transaction: bkper.Transaction): string', () => {
        it('should return the remoteId of the sale transaction in the Inventory Book', () => {

            const transaction = {
                id: '123',
                creditAccount: {
                    type: AccountType.INCOMING,
                },
            };

            const query = new EventHandlerTransactionChecked().getTransactionQuery(transaction);

            expect(query).to.equal(`remoteId:123`);
        });
    });

});