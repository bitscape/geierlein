/**
 * Frontend logic for Geierlein HTML5 interface.
 *
 * @author Stefan Siegl
 *
 * Copyright (c) 2012 Stefan Siegl <stesie@brokenpipe.de>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(function($, geierlein) {
    var $jahr = $('#jahr');
    var $monat = $('#monat');

    var datenlieferant, ustva;

    /*
     * private functions
     */


    /**
     * Print iframe by element ID.
     *
     * Requires printPage javascript function on the document loaded into
     * the iframe.  File ustva.xsl is extended accordingly.
     *
     * http://stackoverflow.com/questions/472951/how-do-i-print-an-iframe-from-javascript-in-safari-chrome
     *
     * @param id The iframe element's ID.
     */
    function printIframe(id) {
        var iframe = document.frames ? document.frames[id] : document.getElementById(id);
        var ifWin = iframe.contentWindow || iframe;
        ifWin.focus();
        ifWin.printPage();
        return false;
    }

    /**
     * Show the modal protocol dialog and display the provided protocol.
     *
     * A reference to the XSL file needed to display the protocol is
     * added automatically.
     *
     * @param res The XML result document as a string.
     * @return void
     */
    function showProtocol(res) {
        /* Add XSL reference to XML document. */
        var xslUrl = location.href.replace(/[^\/]+$/, 'xsl/ustva.xsl');
        res = geierlein.util.addStylesheetHref(res, xslUrl);

        $('body').trigger('show-protocol', res);
        $('#protocol-frame')[0].src = 'data:text/xml;charset=ISO8859-1,' + escape(res);
        $('#protocol').modal();
    }

    function updateModelHandler(el, model) {
        var kz = el.id.toLowerCase();
        var $cg = $(el).parents('.control-group');
        var value = el.value;

        if(el.type === 'checkbox' && !el.checked) {
            value = '';
        }

        if(value === '') {
            delete model[kz];
        } else {
            model[kz] = value.replace(',', '.');
        }

        if(model.validate(kz) === true) {
            $cg.removeClass('error');
        } else {
            $cg.addClass('error');
        }
    }


    /*
     * Public API
     */


    /**
     * Submit the tax declaration and display protocol afterwards.
     *
     * @param asTestcase Whether to set test-marker in the declaration or not.
     * @return void
     */
    geierlein.sendData = function(asTestcase) {
        if(ustva.validate() !== true) {
            alert('Das Formular enthält noch ungültige Feldwerte, ' +
                'Übertragung nicht möglich.');
            return;
        }

        if(!asTestcase && !confirm('Die Daten werden als Echtfall an die Finanzverwaltung übergeben\n' +
            'Bist du sicher?')) {
            return;
        }

        $('body').trigger('send-taxcase', asTestcase);
        ustva.toEncryptedXml(asTestcase, undefined, function(data, cb) {
            $('#wait').modal();
            geierlein.transfer(data, cb);
        }, function(res) {
            $('#wait').modal('hide');
            if(res === false) {
                alert('Bei der Datenübertragung ist ein Fehler aufgetreten.');
                return;
            }

            var status = res.match(/<Code>(.*?)<\/Code>\s*<Text>(.*?)<\/Text>/);
            if(+status[1] === 0) {
                showProtocol(res);
            } else {
                alert('Die Datenübertragung wurde vom Server abgebrochen:\n' +
                    status[2] + '\nFehlercode: ' + status[1]);
            }
        });
    };
    
    geierlein.isDatenlieferantValid = function() {
        return datenlieferant.validate() === true;
    };

    geierlein.getTaxcaseIdentifier = function() {
        var id = ustva.steuernummer.replace(/[^0-9]/g, '');
        /* add year & month */
        id += "_" + ustva.jahr + ("0" + ustva.monat).substr(-2);
        if(ustva.kz10 == 1) {
            id += "_mod";
        }
        return id;
    };

    geierlein.resetForm = function() {
        $('form')[0].reset();

        /* Pre-select previous month and year. */
        var d = new Date();
        d.setMonth(d.getMonth() - 1);
        $jahr.val(d.getFullYear());
        $monat.val(d.getMonth() + 1);

        $('body').trigger('reset-form');

        /* Copy over all field data initially to consider browser's
         * auto-fill data, etc.pp
         */
        $('.datenlieferant, .ustva').change();
    };

    geierlein.serialize = function() {
        var res = '#\n# Adresse des Steuerpflichtigen\n#\n';
        $('.datenlieferant').each(function(i, el) {
            res += el.id + ' = ' + el.value + '\n';
        });

        res += '\n';
        $('.ustva').each(function(i, el) {
            var field = el.id;
            var help = $(el).data('original-title');

            if(field.substr(0, 2) === 'Kz') {
                field = 'k' + field.substr(1);
            }

            if(help !== '') {
                help = help.replace(/<br\/>Kennzahl im Formular: \d+/, '');
                res += '# ' + help + '\n';
            }

            if(el.type === 'checkbox' && !el.checked) {
                res += '# '; /* Comment out next line */
            }
            res += field + ' = ' + el.value + '\n\n';
        });

        return res;
    };

    /**
     * Unserialize data from "geierlein file format" into the form.
     *
     * @param data The file's content as a string.
     * @return <boolean> True if file was loaded successfully, false otherwise.
     */
    geierlein.unserialize = function(data) {
        try {
            data = geierlein.util.parseFile(data);
        } catch(e) {
            alert('Das Format der Datei ist fehlerhaft.  ' +
                'Die Datei kann nicht geöffnet werden');
            return false;
        }

        geierlein.resetForm();
        for(var key in data) {
            if(data.hasOwnProperty(key)) {
                /* The IDs of the input elements in the form start with
                 * an upper-case K.
                 */
                var newValue = data[key];

                if(key.substr(0, 2) === 'kz') {
                    key = 'K' + key.substr(1);
                }

                var $el = $('#' + key);
                if($el.length) {
                    $el.val(newValue).change();
                }
            }
        }

        return true;
    };

    /*
     * Model handling.
     */

    (function() {
        /* Fill year drop-down, supported is 2011 until now. */
        var d = new Date();
        for(var year = d.getFullYear(); year >= 2011; year --) {
            $('<option>').text(year).appendTo($jahr);
        }
    })();

    datenlieferant = new geierlein.Datenlieferant();
    ustva = new geierlein.UStVA(datenlieferant);

    /* Bind datenlieferant input fields to the model.  We bind change as
       well as keyup, so we are able to revalidate the form on every keystroke
       and still don't miss events in case our user copy & pastes the data. */
    $('.datenlieferant').on('change keyup', function(ev) {
        return updateModelHandler(this, datenlieferant);
    });

    /* Bind UStVA form fields to the corresponding model.  Like as for the
       datenlieferant fields we bind to both, change and keyup, events. */
    $('.ustva').on('change keyup', function(ev) {
        return updateModelHandler(this, ustva);
    });
    
    $('#land').on('change keyup', function(ev) {
        $('#steuernummer').attr('placeholder', ustva.getTaxNumberSample());
    });

    geierlein.resetForm();



    /*
     * Further event listeners needed to make the GUI work.
     */

    /**
     * Show/hide rarely used elements, when fast entry checkbox is toggled.
     */
    $('#schnell').on('click', function(ev) {
        if($('#schnell').hasClass('active')) {
            $('.schnell').hide('slow');
        } else {
            $('.schnell').show('slow');
        }

        ev.preventDefault();
    });

    /**
     * Send button, click event.
     */
    $('#send').on('click', function(ev) {
        geierlein.sendData(false);
        return false;
    });

    /**
     * Send-as-testcase button, click event.
     */
    $('#send-testcase').on('click', function(ev) {
        geierlein.sendData(true);
        return false;
    });

    /**
     * Initialize tooltips on all input elements.
     */
    $('.ustva').tooltip();

    /**
     * Trigger browser's print functionality when print-button is clicked in
     * protocol dialog.
     */
    $('#protocol-print').click(function() {
        printIframe('protocol-frame');
    });
}(jQuery, geierlein));
