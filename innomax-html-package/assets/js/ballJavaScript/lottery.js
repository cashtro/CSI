// lottery.js

(function () {

    // Récupérer les participants déjà sélectionnés depuis le localStorage
    var choosed = JSON.parse(localStorage.getItem('choosed')) || {};

    // Fonction pour générer une vitesse aléatoire
    var speed = function () {
        return [0.1 * Math.random() + 0.01, -(0.1 * Math.random() + 0.01)];
    };

    // Fonction pour générer une clé unique pour chaque participant
    var getKey = function (item) {
        return item.name + '-' + item.phone;
    };

    // Fonction pour créer le HTML des participants
    var createHTML = function () {
        var html = ['<ul>'];
        member.forEach(function (item, index) {
            item.index = index;
            var key = getKey(item);
            var color = choosed[key] ? 'yellow' : 'white';
            html.push('<li><a href="#" style="color: ' + color + ';">' + item.name + '</a></li>');
        });
        html.push('</ul>');
        return html.join('');
    };

    // Fonction pour effectuer le tirage au sort
    var lottery = function (count) {
        var list = canvas.getElementsByTagName('a');
        var color = 'yellow';
        var ret = member
            .filter(function (m, index) {
                m.index = index;
                return !choosed[getKey(m)];
            })
            .map(function (m) {
                return Object.assign({
                    score: Math.random()
                }, m);
            })
            .sort(function (a, b) {
                return a.score - b.score;
            })
            .slice(0, count)
            .map(function (m) {
                choosed[getKey(m)] = 1;
                list[m.index].style.color = color;
                return m.name + '<br/>' + m.phone;
            });
        localStorage.setItem('choosed', JSON.stringify(choosed));
        return ret;
    };

    // Initialiser le canvas
    var canvas = document.getElementById('lottery-canvas');
    canvas.width = document.getElementById('lottery-section').offsetWidth;
    canvas.height = document.getElementById('lottery-section').offsetHeight;
    canvas.innerHTML = createHTML();

    // Démarrer l'animation du canvas
    TagCanvas.Start('lottery-canvas', '', {
        textColour: 'white',
        initial: speed(),
        dragControl: 1,
        textHeight: 14
    });

    // Fonction pour démarrer le tirage au sort
    function startLottery() {
        var ret = lottery(1); // Changez le nombre de gagnants si nécessaire
        if (ret.length === 0) {
            document.getElementById('lottery-result').style.display = 'block';
            document.getElementById('lottery-result').innerHTML = '<span>已抽完</span>';
            return;
        }
        document.getElementById('lottery-result').style.display = 'block';
        document.getElementById('lottery-result').innerHTML = '<span>' + ret.join('</span><span>') + '</span>';
        TagCanvas.Reload('lottery-canvas');
        setTimeout(function () {
            localStorage.setItem(new Date().toString(), JSON.stringify(ret));
            document.getElementById('lottery-main').classList.add('mask');
        }, 300);
    }

    // Démarrer le tirage au sort automatiquement après un délai
    setTimeout(startLottery, 5000); // Démarrer après 5 secondes
})();

