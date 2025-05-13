const express = require('express');
const router = express.Router();
const authTokenHandler = require('../Middlewares/checkAuthToken');
const jwt = require('jsonwebtoken');
const errorHandler = require('../Middlewares/errorMiddleware');
const request = require('request');
const User = require('../Models/UserSchema');
require('dotenv').config();


function createResponse(ok, message, data) {
    return {
        ok,
        message,
        data,
    };
}


router.get('/test', authTokenHandler, async (req, res) => {
    res.json(createResponse(true, 'Test API works for calorie intake report'));
});

router.post('/addcalorieintake', authTokenHandler, async (req, res) => {
    const { item, date, quantity, quantitytype } = req.body;
    if (!item || !date || !quantity || !quantitytype) {
        return res.status(400).json(createResponse(false, 'Please provide all the details'));
    }

    if (!item.trim()) {
        return res.status(400).json(createResponse(false, 'Please provide a valid item name'));
    }

    let qtyingrams = 0;
    const parsedQuantity = parseFloat(quantity);

    if (isNaN(parsedQuantity)) {
        return res.status(400).json(createResponse(false, 'Invalid quantity provided'));
    }

    if (quantitytype === 'g') {
        qtyingrams = parsedQuantity;
    } else if (quantitytype === 'kg') {
        qtyingrams = parsedQuantity * 1000;
    } else if (quantitytype === 'ml') {
        qtyingrams = parsedQuantity;
    } else if (quantitytype === 'l') {
        qtyingrams = parsedQuantity * 1000;
    } else {
        return res.status(400).json(createResponse(false, 'Invalid quantity type'));
    }

    const query = item.trim();

    request.get({
        url: 'https://api.calorieninjas.com/v1/nutrition?query=' + encodeURIComponent(query),
        headers: {
            'X-Api-Key': process.env.NUTRITION_API_KEY,
        },
    }, async function (error, response, body) {
        if (error) {
            console.error('Nutrition API request failed:', error);
            return res.status(500).json(createResponse(false, 'Failed to fetch nutrition data'));
        } else if (response.statusCode !== 200) {
            console.error('Nutrition API Error:', response.statusCode, body.toString('utf8'));
            return res.status(response.statusCode).json(createResponse(false, 'Failed to fetch nutrition data', body.toString('utf8')));
        } else {
            try {
                const nutrition = JSON.parse(body);
                const nutritionData=nutrition.items

                if (!nutritionData) {
                    console.log("Error: nutritionData is null or undefined");
                    return res.status(404).json(createResponse(false, 'Nutrition data not found (null/undefined response)'));
                } else if (nutritionData.length === 0) {
                    console.log("Error: nutritionData array is empty");
                    return res.status(404).json(createResponse(false, 'Nutrition data not found (empty array)'));
                } else if (!nutritionData[0]) {
                    console.log("Error: nutritionData[0] is undefined");
                    return res.status(404).json(createResponse(false, 'Nutrition data not found (no item in response)'));
                } else if (nutritionData[0].calories === undefined) {
                    console.log("Error: nutritionData[0].calories is undefined");
                    return res.status(404).json(createResponse(false, 'Nutrition data not found (calories missing)'));
                } else if (nutritionData[0].serving_size_g === undefined) {
                    console.log("Error: nutritionData[0].serving_size_g is undefined");
                    return res.status(404).json(createResponse(false, 'Nutrition data not found (serving size missing)'));
                }

                const calories = nutritionData[0].calories;
                const serving_size_g = nutritionData[0].serving_size_g;

                if (typeof calories !== 'number') {
                    console.error("Error: calories is not a number for item:", item, "Value:", calories);
                    return res.status(500).json(createResponse(false, 'Error calculating calorie intake (calories issue)'));
                }

                if (typeof serving_size_g !== 'number' || serving_size_g === 0) {
                    console.error("Error: serving_size_g is not a valid number (> 0) for item:", item, "Value:", serving_size_g);
                    return res.status(500).json(createResponse(false, 'Error calculating calorie intake (serving size issue)'));
                }

                const caloriesPerGram = calories / serving_size_g;
                let calorieIntake = caloriesPerGram * qtyingrams;

                // **Error Identification:** Check if calorieIntake is NaN
                if (isNaN(calorieIntake)) {
                    console.error('Error: Calculated calorieIntake is NaN', { calories, serving_size_g, qtyingrams });
                    return res.status(500).json(createResponse(false, 'Error calculating calorie intake (result is NaN)'));
                }

                const userId = req.userId;
                const user = await User.findOne({ _id: userId });

                user.calorieIntake.push({
                    item: item.trim(),
                    date: new Date(date),
                    quantity: parsedQuantity,
                    quantitytype,
                    calorieIntake: parseFloat(calorieIntake.toFixed(2)),
                });

                await user.save();
                res.json(createResponse(true, 'Calorie intake added successfully'));

            } catch (parseError) {
                console.error('Error parsing Nutrition API response:', parseError);
                return res.status(500).json(createResponse(false, 'Error processing nutrition data'));
            }
        }
    });
});
router.post('/getcalorieintakebydate', authTokenHandler, async (req, res) => {
    const { date } = req.body;
    const userId = req.userId;
    const user = await User.findById({ _id: userId });
    if (!date) {
        let date = new Date();   // sept 1 2021 12:00:00
        user.calorieIntake = filterEntriesByDate(user.calorieIntake, date);

        return res.json(createResponse(true, 'Calorie intake for today', user.calorieIntake));
    }
    user.calorieIntake = filterEntriesByDate(user.calorieIntake, new Date(date));
    res.json(createResponse(true, 'Calorie intake for the date', user.calorieIntake));

})
router.post('/getcalorieintakebylimit', authTokenHandler, async (req, res) => {
    const { limit } = req.body;
    const userId = req.userId;
    const user = await User.findById({ _id: userId });
    if (!limit) {
        return res.status(400).json(createResponse(false, 'Please provide limit'));
    } else if (limit === 'all') {
        return res.json(createResponse(true, 'Calorie intake', user.calorieIntake));
    }
    else {


        let date = new Date();
        let currentDate = new Date(date.setDate(date.getDate() - parseInt(limit))).getTime();
        // 1678910

        user.calorieIntake = user.calorieIntake.filter((item) => {
            return new Date(item.date).getTime() >= currentDate;
        })


        return res.json(createResponse(true, `Calorie intake for the last ${limit} days`, user.calorieIntake));


    }
})
router.delete('/deletecalorieintake', authTokenHandler, async (req, res) => {
    const { item, date } = req.body;
    if (!item || !date) {
        return res.status(400).json(createResponse(false, 'Please provide all the details'));
    }

    const userId = req.userId;
    const user = await User.findById({ _id: userId });

    user.calorieIntake = user.calorieIntake.filter((entry) => {
        return entry.date.toString()!==new Date(date).toString()
    })
    await user.save();
    res.json(createResponse(true, 'Calorie intake deleted successfully'));

})
router.get('/getgoalcalorieintake', authTokenHandler, async (req, res) => {
    const userId = req.userId;
    const user = await User.findById({ _id: userId });
    let maxCalorieIntake = 0;
    let heightInCm = parseFloat(user.height[user.height.length - 1].height);
    let weightInKg = parseFloat(user.weight[user.weight.length - 1].weight);
    let age = new Date().getFullYear() - new Date(user.dob).getFullYear();
    let BMR = 0;
    let gender = user.gender;
    if (gender == 'male') {
        BMR = 88.362 + (13.397 * weightInKg) + (4.799 * heightInCm) - (5.677 * age)

    }
    else if (gender == 'female') {
        BMR = 447.593 + (9.247 * weightInKg) + (3.098 * heightInCm) - (4.330 * age)

    }
    else {
        BMR = 447.593 + (9.247 * weightInKg) + (3.098 * heightInCm) - (4.330 * age)
    }
    if (user.goal == 'weightLoss') {
        maxCalorieIntake = BMR - 500;
    }
    else if (user.goal == 'weightGain') {
        maxCalorieIntake = BMR + 500;
    }
    else {
        maxCalorieIntake = BMR;
    }

    res.json(createResponse(true, 'max calorie intake', { maxCalorieIntake }));

})


function filterEntriesByDate(entries, targetDate) {
    return entries.filter(entry => {
        const entryDate = new Date(entry.date);
        return (
            entryDate.getDate() === targetDate.getDate() &&
            entryDate.getMonth() === targetDate.getMonth() &&
            entryDate.getFullYear() === targetDate.getFullYear()
        );
    });
}
module.exports = router;
