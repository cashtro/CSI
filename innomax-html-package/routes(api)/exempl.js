/*const express = require('express');
const { generateToken } = require('../utils/jwt');
const { hashPassword, comparePassword } = require('../utils/hash');

const router = express.Router();

router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
        return res.status(400).json({ message: "Email déjà utilisé" });
    }

    const hashedPassword = await hashPassword(password);
    await User.create(name, email, hashedPassword);
    
    res.status(201).json({ message: "Utilisateur inscrit avec succès !" });
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findByEmail(email);

    if (!user || !(await comparePassword(password, user.password))) {
        return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    const token = generateToken(user);
    res.json({ token });
});

module.exports = router;
*/