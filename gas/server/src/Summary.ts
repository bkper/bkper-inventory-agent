class Summary {

    private accountId: string;
    private result: any = {};
    private error = false;

    constructor(accountId: string) {
        this.accountId = accountId;
    }

    getResult(): string {
        return JSON.stringify(this.result);
    }

    done(msg?: string): this {
        if (msg) {
            this.result = msg;
            return this;
        }
        this.result = `Done! ${JSON.stringify(this.result)}`;
        return this;
    }

    rebuild(): this {
        this.result = 'Account needs rebuild: reseting async...';
        return this;
    }

    resetingAsync(): this {
        this.result = 'Reseting async...';
        return this;
    }

    calculatingAsync(): this {
        this.result = 'Calculating async...';
        return this;
    }

    lockError(): this {
        this.error = true;
        this.result = 'Cannot proceed: collection has locked/closed book(s)';
        return this;
    }

    quantityError(): this {
        this.error = true;
        this.result = 'Cannot proceed: sales quantity is greater than quantity purchased';
        return this;
    }

    json(): this {
        this.result = JSON.stringify(this.result);
        return this;
    }

}