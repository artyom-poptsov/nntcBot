const mongoose = require('mongoose');

const activitiesSchema = mongoose.Schema({
    subjectID:  {type: Number}, // User ID
    objectID:   {type: Number}  // User ID
});

const Activity = mongoose.model('Activities', activitiesSchema);

module.exports.add = async (subjectID, objectID) => {
    const activity = new Activity({
        subjectID: subjectID,
        objectID:  objectID
    });

    try {
        await activity.save();
    } catch (err) {
        throw new Error("Ошибка сохранения активности", err);
    }
};

module.exports.find = async (subjectID) => {
    return new Promise(resolve => {
        Activity.findOne({subjectID: subjectID},
            (err, data) => {
                resolve(data);
            });
    });
};

module.exports.remove = async (subjectID, objectID) => {
    await Activity.remove({subjectID: {$eq: subjectID}});
};
