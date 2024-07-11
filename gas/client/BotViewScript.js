let template = undefined;

// Fetch template variables from Server
init();

function init() {
    google.script.url.getLocation(loadTemplate);
}

function loadTemplate(location) {
    const parameters = location.parameter;
    disableButtons(true);
    return google.script.run.withSuccessHandler((t) => setTemplate(t)).getTemplate(parameters);
}

function setTemplate(t) {
    template = t;
    if (template) {
        disableButtons(false);
    }
}

async function calculate() {
    disableButtons(true);
    google.script.run
        .withSuccessHandler(async () => {
            await fireCalculateForAll().catch(showError);
            disableButtons(false);
        })
        .withFailureHandler((error) => {
            showError(error);
            disableButtons(false);
        })
        .validate(template.book.id)
        ;
}

function fireCalculateForAll() {
    google.script.run.withSuccessHandler(disableButtons(false)).withFailureHandler(showError).calculateCostOfSales(template.book.id, template.account.id);
}

function showError(error) {
    window.alert(error);
}

function disableButtons(disable) {
    if (disable) {
        document.getElementById('calculate-button').setAttribute('disabled', true);
        document.getElementById('close-button').setAttribute('disabled', true);
    } else {
        document.getElementById('calculate-button').removeAttribute('disabled');
        document.getElementById('close-button').removeAttribute('disabled');
    }
}

function closeWindow() {
    try {
        window.top.close();
    } catch (error) {
        console.log("Attempt to automatically close window failed: " + error);
        showError(error);
    }
}