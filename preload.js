window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector)
        if (element) element.innerText = text
    }

    for (const type of ['chrome', 'node', 'electron']) {
        replaceText(`${type}-version`, process.versions[type])
    }

    var rangeInput = document.getElementById('myRange');
    var rangeValue = document.getElementById('range-value');

// Add an event listener for the 'input' event
    rangeInput.addEventListener('input', function() {

        console.log('Value changed to: ' + this.value);
       // rangeValue.innerText(rangeInput);
       //  exec("ls -la", (error, stdout, stderr) => {
       //      if (error) {
       //          console.log(`error: ${error.message}`);
       //          return;
       //      }
       //      if (stderr) {
       //          console.log(`stderr: ${stderr}`);
       //          return;
       //      }
       //      console.log(`stdout: ${stdout}`);
       //  });


        // This function will be called whenever the value of the range input changes

    });



})

