const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true });
const { AssemblyAI } = window.AssemblyAI; // Import AssemblyAI SDK

// API keys
const CLARIFAI_PAT = '9ff45cfd14e649c2b76300b463387040'; // Your Clarifai PAT
const ASSEMBLYAI_API_KEY = 'f8faa3bbf3d543ab990f6f38bd9adec6'; // Your AssemblyAI API key

// Initialize AssemblyAI client
const assemblyaiClient = new AssemblyAI({
  apiKey: ASSEMBLYAI_API_KEY,
});

// Clarifai workflow URLs
const EMOTION_WORKFLOW_URL = 'https://api.clarifai.com/v2/workflows/emotion/workflows/face-sentiment-recognition-workflow-jlj161';
const FACE_DETECTION_WORKFLOW_URL = 'https://api.clarifai.com/v2/workflows/face-detection/workflows/face-detection-workflow-5cbii';
const GENERAL_WORKFLOW_URL = 'https://api.clarifai.com/v2/workflows/general/workflows/general-image-recognition-workflow-3d5qu';

// Function to process the video
async function processVideo(videoFile) {
  if (!videoFile) {
    alert('Please upload a video!');
    return;
  }

  // Show loading state
  const button = document.querySelector('button');
  button.innerText = 'Processing...';
  button.disabled = true;

  try {
    // Load FFmpeg
    if (!ffmpeg.isLoaded()) {
      await ffmpeg.load();
    }

    // Write the uploaded file to FFmpeg's file system
    const videoName = 'input.mp4';
    ffmpeg.FS('writeFile', videoName, await fetchFile(videoFile));

    // Step 1: Get video duration
    const duration = await getVideoDuration(videoName);
    const keyMoments = findKeyMoments(duration);

    // Step 2: Create 5 strategic short clips
    const outputDiv = document.getElementById('output');
    outputDiv.innerHTML = ''; // Clear previous output
    outputDiv.style.display = 'block';

    for (let i = 0; i < 5; i++) {
      const startTime = keyMoments[i];
      const shortName = `short_${i + 1}.mp4`;

      // Trim and resize the video
      await ffmpeg.run(
        '-i', videoName,
        '-vf', 'scale=1080:1920',
        '-ss', startTime.toString(),
        '-t', '30', // Each short is 30 seconds long
        shortName
      );

      // Step 3: Add subtitles using AssemblyAI
      await addSubtitles(shortName);

      // Step 4: Analyze the short clip with Clarifai
      const analysis = await analyzeShortClip(shortName);

      // Step 5: Generate download link
      const data = ffmpeg.FS('readFile', shortName);
      const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(videoBlob);

      // Display the short clip
      const shortContainer = document.createElement('div');
      shortContainer.className = 'short-container';

      const videoElement = document.createElement('video');
      videoElement.src = videoUrl;
      videoElement.controls = true;

      const downloadLink = document.createElement('a');
      downloadLink.href = videoUrl;
      downloadLink.download = shortName;
      downloadLink.innerText = `Download Short ${i + 1}`;

      const analysisDiv = document.createElement('div');
      analysisDiv.innerHTML = `<pre>${JSON.stringify(analysis, null, 2)}</pre>`;

      shortContainer.appendChild(videoElement);
      shortContainer.appendChild(downloadLink);
      shortContainer.appendChild(analysisDiv);
      outputDiv.appendChild(shortContainer);
    }
  } catch (error) {
    console.error('Error processing video:', error);
    alert('An error occurred while processing the video.');
  } finally {
    // Reset button
    button.innerText = 'Process Video';
    button.disabled = false;
  }
}

// Helper function to get video duration
async function getVideoDuration(videoName) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const originalLog = console.log;
    console.log = (message) => {
      logs.push(message);
      originalLog(message);
    };

    ffmpeg.run('-i', videoName)
      .then(() => {
        console.log = originalLog; // Restore original console.log
        const logText = logs.join('\n');
        const durationMatch = logText.match(/Duration: (\d+):(\d+):(\d+)/);
        if (durationMatch) {
          const hours = parseInt(durationMatch[1]);
          const minutes = parseInt(durationMatch[2]);
          const seconds = parseInt(durationMatch[3]);
          resolve(hours * 3600 + minutes * 60 + seconds);
        } else {
          reject(new Error('Could not determine video duration.'));
        }
      })
      .catch((error) => {
        console.log = originalLog; // Restore original console.log
        reject(error);
      });
  });
}

// Helper function to find key moments in the video
function findKeyMoments(duration) {
  const keyMoments = [
    Math.floor(duration * 0.1), // 10% of the video
    Math.floor(duration * 0.3), // 30% of the video
    Math.floor(duration * 0.5), // 50% of the video
    Math.floor(duration * 0.7), // 70% of the video
    Math.floor(duration * 0.9), // 90% of the video
  ];
  return keyMoments;
}

// Function to add subtitles using AssemblyAI
async function addSubtitles(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(videoBlob);

  // Transcribe audio using AssemblyAI
  const config = {
    audio_url: videoUrl,
  };

  try {
    const transcript = await assemblyaiClient.transcripts.transcribe(config);
    console.log('Subtitles:', transcript.text);

    // Overlay subtitles on the video using FFmpeg
    const subtitleFile = 'subtitles.srt';
    ffmpeg.FS('writeFile', subtitleFile, new TextEncoder().encode(transcript.text));
    await ffmpeg.run(
      '-i', videoName,
      '-vf', `subtitles=${subtitleFile}`,
      'output_with_subtitles.mp4'
    );

    // Replace the original video with the subtitled version
    ffmpeg.FS('unlink', videoName);
    ffmpeg.FS('rename', 'output_with_subtitles.mp4', videoName);
  } catch (error) {
    console.error('Error adding subtitles:', error);
  }
}

// Function to analyze a short clip with Clarifai
async function analyzeShortClip(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(videoBlob);

  // Analyze with Clarifai workflows
  const emotionAnalysis = await clarifaiAnalyze(videoUrl, EMOTION_WORKFLOW_URL);
  const faceAnalysis = await clarifaiAnalyze(videoUrl, FACE_DETECTION_WORKFLOW_URL);
  const generalAnalysis = await clarifaiAnalyze(videoUrl, GENERAL_WORKFLOW_URL);

  return { emotionAnalysis, faceAnalysis, generalAnalysis };
}

// Function to call Clarifai API
async function clarifaiAnalyze(imageUrl, workflowUrl) {
  const response = await fetch(workflowUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${CLARIFAI_PAT}`,
    },
    body: JSON.stringify({
      inputs: [{ data: { image: { url: imageUrl } } }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Clarifai API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

// Example usage
document.getElementById('processVideo').onclick = async () => {
  const videoFile = document.getElementById('videoInput').files[0];
  await processVideo(videoFile);
};
