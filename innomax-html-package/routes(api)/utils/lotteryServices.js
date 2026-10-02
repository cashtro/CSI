const { createClient } = require('@supabase/supabase-js');
const { sendLotteryWinnerEmail, sendLotteryOwnerEmail } = require('./emailService');
const { createSupabaseAdmin } = require('./supabaseUtil');

async function performLotteryDraw() {
    const supabaseAdmin = createSupabaseAdmin();
    try {
        // Step 1: Try to lock the first eligible lottery that meets the conditions
        // `now` is the current date and time in ISO format
        const now = new Date().toISOString();

        // Lock a lottery for processing by setting `isProcessing` to true
        // The lottery must be active, have no winner yet (idGagnant is null),
        // its lottery time must have passed, and it must not already be in processing.
        const { data: lockedLottery, error: lockError } = await supabaseAdmin
            .from('Lottery')
            .update({ isProcessing: true })  // Lock the lottery for processing
            .eq('isActive', true)  // Only consider active lotteries
            .is('idGagnant', null)  // Only consider lotteries with no winner yet
            .lte('lotteryTime', now)  // Ensure the lottery time has passed
            .is('isProcessing', false)  // Only lock if the lottery is not already being processed
            .order('lotteryTime', { ascending: true })  // Order by earliest lottery time
            .limit(1)  // Only select 1 lottery to process
            .select('*')  // Select all columns so we can access the lottery's data
            .maybeSingle();  // Ensure we get a single result or null if not found

        if (lockError) {
            // If there's an error while locking the lottery, log it and exit
            console.error('[Lock Error]', lockError.message);
            return;
        }

        if (!lockedLottery) {
            // If no lottery was found or locked, exit early (nothing to process)
            return;
        }

        const lottery = lockedLottery; // The lottery we will process

        if (lottery.totalEntries < lottery.minimumEntryNeeded) {
            // Pas assez de participants : on reporte de 24h
            await supabaseAdmin
                .from('Lottery')
                .update({
                    isProcessing: false,
                    lotteryTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
                })
                .eq('lotteryId', lottery.lotteryId);
            return;
        }

        // Step 2: Fetch entries for the selected lottery
        // Get the users and their entry counts for this lottery
        const { data: entries, error: entriesError } = await supabaseAdmin
            .from('Entry')
            .select('userId, entryCount')  // Get userId and entryCount for each entry
            .eq('lotteryId', lottery.lotteryId);  // Filter entries by the lotteryId

        if (entriesError || !entries || entries.length === 0) {
            // If there was an error or no entries, log the error and reset the isProcessing flag and add more time to the lottery
            console.error('[Entries Error]', entriesError?.message);
            // Reset isProcessing to false to unlock the lottery
            await supabaseAdmin
                .from('Lottery')
                .update({ isProcessing: false })
                .eq('lotteryId', lottery.lotteryId);
            return;
        }

        // Step 3: Build the ticket pool from the entries
        const ticketPool = [];
        entries.forEach(entry => {
            // For each entry, add the userId to the ticketPool based on their entryCount
            for (let i = 0; i < entry.entryCount; i++) {
                ticketPool.push(entry.userId);  // Add userId to ticket pool for each entry
            }
        });

        if (ticketPool.length === 0) {
            // If there are no tickets in the pool (no valid entries), reset isProcessing and exit
            await supabaseAdmin
                .from('Lottery')
                .update({ isProcessing: false })
                .eq('lotteryId', lottery.lotteryId);
            return;
        }

        // Step 4: Pick a random winner
        const randomIndex = Math.floor(Math.random() * ticketPool.length);  // Generate a random index
        const idGagnant = ticketPool[randomIndex];  // Get the winner's userId

        // Step 5: Get winner details (username and email)
        const { data: winnerData, error: winnerError } = await supabaseAdmin
            .from('Users')
            .select('email, username')
            .eq('userId', idGagnant)
            .single();

        if (winnerError) {
            console.error('Error fetching winner details:', winnerError);
            await supabaseAdmin
                .from('Lottery')
                .update({ isProcessing: false })
                .eq('lotteryId', lottery.lotteryId);
            return;
        }

        // Step 6: Update the lottery record with the winner's information
        // Set the winner (idGagnant), mark the lottery as no longer active, and unlock the lottery
        const { error: updateError } = await supabaseAdmin
            .from('Lottery')
            .update({
                idGagnant,  // Set the winner's userId
                isActive: false,  // Mark the lottery as no longer active
                isProcessing: false  // Unlock the lottery
            })
            .eq('lotteryId', lottery.lotteryId);  // Match the specific lottery by its ID

        if (updateError) {
            // If there's an error while updating the lottery, log it and exit
            console.error('Error updating lottery:', updateError.message);
            return;
        }

        //Step 7: Send email notifications
        try {
            // Send winner notification
            await sendLotteryWinnerEmail(winnerData.email, {
                winnerUsername: winnerData.username,
                name: lottery.nomProduit,
                ownerEmail: process.env.EMAIL_USER,
            });

            // Send owner notification with winner details
            await sendLotteryOwnerEmail(process.env.EMAIL_USER, {
                winnerEmail: winnerData.email,
                winnerUsername: winnerData.username,
                lotteryName: lottery.nomProduit,
                ownerEmail: process.env.EMAIL_USER,
            });
        } catch (emailError) {
            console.error('Error sending email notifications:', emailError);
            // We don't return here because the lottery was already updated successfully
        }

    } catch (err) {
        // If any error occurs during the process, log it
        console.error('Error during lottery draw:', err.message);
    }
}

module.exports = { performLotteryDraw };
